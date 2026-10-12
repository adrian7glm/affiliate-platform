import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AvailabilityProvider, HoldExpiredError, SoldOutError } from './provider';

/**
 * A minimal operator system implementing the REST adapter contract (docs/rest-adapter.md) on top
 * of any provider, usually the in-memory one. Used to test the REST adapter over real HTTP and as
 * a working example for operators who build the API on their side.
 */
export function createReferenceServer(backend: AvailabilityProvider, token: string): Server {
  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
      : {};
  };

  return createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${token}`)
        return send(res, 401, { error: 'unauthorized' });
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      try {
        if (req.method === 'GET' && url.pathname === '/products') {
          const products = await backend.listProducts();
          return send(
            res,
            200,
            products.map((p) => ({ ...p, id: p.externalId })),
          );
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
            slots.map((s) => ({
              ...s,
              id: s.externalId,
              startsAt: s.startsAt.toISOString(),
              endsAt: s.endsAt.toISOString(),
            })),
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
          const customer = body.customer as {
            name: string;
            email: string | null;
            phone: string | null;
          };
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
