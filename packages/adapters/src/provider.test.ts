import { type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type AvailabilityProvider,
  HoldExpiredError,
  InMemoryProvider,
  ProviderError,
  RestProvider,
  SoldOutError,
  createReferenceServer,
} from './index';

const product = {
  externalId: 'sunset',
  name: 'Sunset cruise',
  durationMinutes: 90,
  prices: [{ code: 'adult', label: 'Adult', amountMinor: 15_000, taxRateBps: 900 }],
};
const startsAt = new Date('2026-10-20T16:00:00Z');
const day = { from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') };

/** The behaviour every provider must have, whatever system is behind it. */
function contract(
  name: string,
  setup: () => { provider: AvailabilityProvider; backend: InMemoryProvider; slotId: string },
) {
  describe(`${name}: provider contract`, () => {
    let provider: AvailabilityProvider;
    let slotId: string;

    beforeEach(() => {
      ({ provider, slotId } = setup());
    });

    const hold = (seats: number) =>
      provider.hold({
        productExternalId: 'sunset',
        slotExternalId: slotId,
        startsAt,
        seats,
        ttlSeconds: 600,
      });

    it('lists products with prices', async () => {
      const products = await provider.listProducts();
      expect(products).toEqual([
        expect.objectContaining({ externalId: 'sunset', durationMinutes: 90 }),
      ]);
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
        provider.confirm({
          holdId,
          reference: 'DB-0001',
          customerName: 'John',
          customerEmail: null,
          customerPhone: null,
          seats: 2,
        });
      const { externalRef } = await confirm();
      expect(externalRef).toBeTruthy();
      expect((await confirm()).externalRef).toBe(externalRef); // idempotent
      await provider.cancel(externalRef);
      expect((await provider.getAvailability('sunset', day.from, day.to))[0]?.available).toBe(10);
    });

    it('refuses to confirm a hold that does not exist', async () => {
      await expect(
        provider.confirm({
          holdId: 'missing',
          reference: 'X',
          customerName: 'J',
          customerEmail: null,
          customerPhone: null,
          seats: 1,
        }),
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
    server = createReferenceServer(proxy, 'secret');
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
    await expect(provider.listProducts()).rejects.toMatchObject({
      name: 'ProviderError',
      status: 401,
    });
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
