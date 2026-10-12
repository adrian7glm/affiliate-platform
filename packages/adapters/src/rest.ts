import { z } from 'zod';
import {
  type AvailabilityProvider,
  type ConfirmRequest,
  type HoldRequest,
  type HoldResult,
  HoldExpiredError,
  ProviderError,
  type ProviderProduct,
  type ProviderSlot,
  SoldOutError,
} from './provider';

/**
 * Generic adapter for operators that have their own system with an HTTP API.
 * The operator (or their developer) implements the small API described in docs/rest-adapter.md
 * and the platform talks to it through this class.
 */
export interface RestProviderConfig {
  baseUrl: string;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const productsResponse = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    durationMinutes: z.number().int().positive(),
    prices: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        amountMinor: z.number().int().nonnegative(),
        taxRateBps: z.number().int().min(0).max(10_000).default(0),
      }),
    ),
  }),
);

const slotsResponse = z.array(
  z.object({
    id: z.string().nullable().default(null),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    capacity: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
  }),
);

const holdResponse = z.object({ id: z.string(), expiresAt: z.string().datetime({ offset: true }) });
const confirmResponse = z.object({ bookingRef: z.string() });
const soldOutBody = z.object({ available: z.number().int().nonnegative() }).partial();

export class RestProvider implements AvailabilityProvider {
  readonly kind = 'rest';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: RestProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? fetch;
  }

  async listProducts(): Promise<ProviderProduct[]> {
    const data = productsResponse.parse(await this.request('GET', '/products'));
    return data.map((p) => ({
      externalId: p.id,
      name: p.name,
      durationMinutes: p.durationMinutes,
      prices: p.prices,
    }));
  }

  async getAvailability(productExternalId: string, from: Date, to: Date): Promise<ProviderSlot[]> {
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const path = `/products/${encodeURIComponent(productExternalId)}/availability?${query.toString()}`;
    const data = slotsResponse.parse(await this.request('GET', path));
    return data.map((s) => ({
      externalId: s.id,
      startsAt: new Date(s.startsAt),
      endsAt: new Date(s.endsAt),
      capacity: s.capacity,
      available: Math.min(s.available, s.capacity),
    }));
  }

  async hold(request: HoldRequest): Promise<HoldResult> {
    const response = await this.raw('POST', '/holds', {
      productId: request.productExternalId,
      slotId: request.slotExternalId,
      startsAt: request.startsAt.toISOString(),
      seats: request.seats,
      ttlSeconds: request.ttlSeconds,
    });
    if (response.status === 409) {
      const body = soldOutBody.safeParse(await safeJson(response));
      throw new SoldOutError(body.success ? (body.data.available ?? 0) : 0);
    }
    const data = holdResponse.parse(await this.json(response));
    return { holdId: data.id, expiresAt: new Date(data.expiresAt) };
  }

  async confirm(request: ConfirmRequest): Promise<{ externalRef: string }> {
    const response = await this.raw('POST', `/holds/${encodeURIComponent(request.holdId)}/confirm`, {
      reference: request.reference,
      customer: { name: request.customerName, email: request.customerEmail, phone: request.customerPhone },
      seats: request.seats,
    });
    if (response.status === 404 || response.status === 410) throw new HoldExpiredError(request.holdId);
    const data = confirmResponse.parse(await this.json(response));
    return { externalRef: data.bookingRef };
  }

  async release(holdId: string): Promise<void> {
    const response = await this.raw('DELETE', `/holds/${encodeURIComponent(holdId)}`);
    if (response.status === 404 || response.status === 410) return;
    await this.json(response);
  }

  async cancel(externalRef: string): Promise<void> {
    const response = await this.raw('POST', `/bookings/${encodeURIComponent(externalRef)}/cancel`);
    if (response.status === 404) return;
    await this.json(response);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    return this.json(await this.raw(method, path, body));
  }

  private async raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 8000),
      });
    } catch (error) {
      throw new ProviderError(`operator system unreachable: ${(error as Error).message}`);
    }
  }

  private async json(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new ProviderError(`operator system answered ${response.status}`, response.status);
    }
    if (response.status === 204) return null;
    const body = await safeJson(response);
    if (body === undefined) throw new ProviderError('operator system returned invalid JSON', response.status);
    return body;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}
