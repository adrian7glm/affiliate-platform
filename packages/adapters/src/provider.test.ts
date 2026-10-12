import { type AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AvailabilityProvider,
  HoldExpiredError,
  InMemoryProvider,
  ProviderError,
  RestProvider,
  SoldOutError,
} from './index';

const product = {
  externalId: 'sunset',
  name: 'Sunset cruise',
  durationMinutes: 90,
  prices: [{ code: 'adult', label: 'Adult', amountMinor: 15_000, taxRateBps: 900 }],
};
const startsAt = new Date('2026-10-20T16:00:00Z');
const day = { from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') };

/**
 * A minimal operator system implementing the REST adapter contract (docs/rest-adapter.md),
 * backed by the in-memory provider. Proves the REST adapter end to end over real HTTP.
 */
function referenceServer(backend: InMemoryProvider, token: string): Server {
  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>) : {};
  };

  return createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      try {
        if (req.method === 'GET' && url.pathname === '/products') {
          const products = await backend.listProducts();
          return send(res, 200, products.map((p) => ({ ...p, id: p.externalId })));
        }
        if (req.method === 'GET' && parts[0] === 'products' && parts[2] === 'availability') {
          const slots = await backend.getAvailability(
            parts[1]!,
            new Date(url.searchParams.get('from')!),
            new Date(url.searchParams.get('to')!),
          );
          return send(
            res,
            200,
            slots.map((s) => ({ ...s, id: s.externalId, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
          );
        }
        if (req.method === 'POST' && url.pathname === '/holds') {
          const body = await readBody(req);
          const hold = await backend.hold({
            productExternalId: String(body.productId),
            slotExternalId: (body.slotId as string | null) ?? null,
            startsAt: new Date(String(body.startsAt)),
            seats: Number(body.seats),
            ttlSeconds: Number(body.ttlSeconds),
          });
          return send(res, 201, { id: hold.holdId, expiresAt: hold.expiresAt.toISOString() });
        }
        if (req.method === 'POST' && parts[0] === 'holds' && parts[2] === 'confirm') {
          const body = await readBody(req);
          const customer = body.customer as { name: string; email: string | null; phone: string | null };
          const result = await backend.confirm({
            holdId: parts[1]!,
            reference: String(body.reference),
            customerName: customer.name,
            customerEmail: customer.email,
            customerPhone: customer.phone,
            seats: Number(body.seats),
          });
          return send(res, 200, { bookingRef: result.externalRef });
        }
        if (req.method === 'DELETE' && parts[0] === 'holds') {
          await backend.release(parts[1]!);
          return send(res, 204);
        }
        if (req.method === 'POST' && parts[0] === 'bookings' && parts[2] === 'cancel') {
          await backend.cancel(decodeURIComponent(parts[1]!));
          return send(res, 204);
        }
        return send(res, 404, { error: 'not found' });
      } catch (error) {
        if (error instanceof SoldOutError) return send(res, 409, { available: error.available });
        if (error instanceof HoldExpiredError) return send(res, 410, { error: 'hold expired' });
        return send(res, 500, { error: (error as Error).message });
      }
    })();
  });
}

/** The behaviour every provider must have, whatever system is behind it. */
function contract(name: string, setup: () => { provider: AvailabilityProvider; backend: InMemoryProvider; slotId: string }) {
  describe(`${name}: provider contract`, () => {
    let provider: AvailabilityProvider;
    let slotId: string;

    beforeEach(() => {
      ({ provider, slotId } = setup());
    });

    const hold = (seats: number) =>
      provider.hold({ productExternalId: 'sunset', slotExternalId: slotId, startsAt, seats, ttlSeconds: 600 });

    it('lists products with prices', async () => {
      const products = await provider.listProducts();
      expect(products).toEqual([expect.objectContaining({ externalId: 'sunset', durationMinutes: 90 })]);
      expect(products[0]?.prices[0]).toMatchObject({ code: 'adult', amountMinor: 15_000 });
    });

    it('returns departures with seats left', async () => {
      const slots = await provider.getAvailability('sunset', day.from, day.to);
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({ capacity: 10, available: 10 });
      expect(slots[0]?.startsAt.toISOString()).toBe(startsAt.toISOString());
    });

    it('blocks seats while the customer pays and frees them on release', async () => {
      const { holdId } = await hold(4);
      expect((await provider.getAvailability('sunset', day.from, day.to))[0]?.available).toBe(6);
      await provider.release(holdId);
      await provider.release(holdId); // idempotent
      expect((await provider.getAvailability('sunset', day.from, day.to))[0]?.available).toBe(10);
    });

    it('never sells more seats than the departure has', async () => {
      await hold(8);
      await expect(hold(3)).rejects.toBeInstanceOf(SoldOutError);
    });

    it('confirms a hold into a booking and frees the seats on cancel', async () => {
      const { holdId } = await hold(2);
      const confirm = () =>
        provider.confirm({ holdId, reference: 'DB-0001', customerName: 'John', customerEmail: null, customerPhone: null, seats: 2 });
      const { externalRef } = await confirm();
      expect(externalRef).toBeTruthy();
      expect((await confirm()).externalRef).toBe(externalRef); // idempotent
      await provider.cancel(externalRef);
      expect((await provider.getAvailability('sunset', day.from, day.to))[0]?.available).toBe(10);
    });

    it('refuses to confirm a hold that does not exist', async () => {
      await expect(
        provider.confirm({ holdId: 'missing', reference: 'X', customerName: 'J', customerEmail: null, customerPhone: null, seats: 1 }),
      ).rejects.toBeInstanceOf(HoldExpiredError);
    });
  });
}

function freshBackend() {
  const backend = new InMemoryProvider([product]);
  const slotId = backend.addSlot('sunset', startsAt, 90, 10);
  return { backend, slotId };
}

contract('in-memory', () => {
  const { backend, slotId } = freshBackend();
  return { provider: backend, backend, slotId };
});

describe('REST adapter over HTTP', () => {
  let server: Server;
  let current = freshBackend();
  let baseUrl = '';

  beforeAll(async () => {
    // The server delegates to whichever backend the current test set up.
    const proxy = new Proxy({} as InMemoryProvider, {
      get: (_target, prop) => {
        const value = current.backend[prop as keyof InMemoryProvider];
        return typeof value === 'function' ? value.bind(current.backend) : value;
      },
    });
    server = referenceServer(proxy, 'secret');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  contract('rest', () => {
    current = freshBackend();
    return { provider: new RestProvider({ baseUrl, token: 'secret' }), ...current };
  });

  it('reports a wrong token as a provider error', async () => {
    const provider = new RestProvider({ baseUrl, token: 'wrong' });
    await expect(provider.listProducts()).rejects.toMatchObject({ name: 'ProviderError', status: 401 });
  });

  it('reports an unreachable system as a provider error', async () => {
    const provider = new RestProvider({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });
    await expect(provider.listProducts()).rejects.toBeInstanceOf(ProviderError);
  });

  it('rejects responses that do not follow the contract', async () => {
    const provider = new RestProvider({
      baseUrl: 'http://operator.test',
      fetch: async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }),
    });
    await expect(provider.listProducts()).rejects.toThrow();
  });
});
