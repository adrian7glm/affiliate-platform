import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateWebhookBody,
  type CreatedWebhookDto,
  MAX_WEBHOOK_ENDPOINTS,
  type UpdateWebhookBody,
  WEBHOOK_TEST_EVENT,
  type WebhookBookingPayload,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEventType,
  type WebhookPayload,
  type WebhookTestResultDto,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  auditLog,
  bookingItems,
  bookings,
  products,
  slots,
  tenants,
  webhookDeliveries,
  webhookEndpoints,
} from '@ap/db';
import { and, asc, count, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { openSecret, randomToken, sealSecret } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { assertPublicUrl, publicFetch } from '../sources/public-fetch';
import { webhookSignature } from './webhook-signature';

type Endpoint = typeof webhookEndpoints.$inferSelect;
type Delivery = typeof webhookDeliveries.$inferSelect;

export const MAX_ATTEMPTS = 8;
/** Wait before attempt n+1 after attempt n failed: about two days of retries in all. */
const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
];
/** An event being sent is retried after this long if its worker died mid-send. */
const LEASE_MS = 2 * 60_000;
const TIMEOUT_MS = 10_000;
const BATCH = 25;
/** Sent and abandoned events are kept this long for the delivery history. */
const KEEP_DAYS = 30;

interface SendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

const amount = (minor: number) => (minor / 100).toFixed(2);

/** Short, readable reason a request failed ("ECONNREFUSED", "timeout after 10 s"). */
function failureReason(error: unknown): string {
  const e = error as {
    name?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return `timeout after ${TIMEOUT_MS / 1000} s`;
  }
  return (e?.cause?.code ?? e?.cause?.message ?? e?.message ?? String(error)).slice(0, 300);
}

/**
 * Webhooks: tells the operator's other software (Zapier, Make, accounting, CRM) when a booking is
 * confirmed, paid, cancelled or boarded. Events are written in the transaction that handled the
 * domain event and sent by the worker with retries, each request signed with the address's secret.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');
  private delivering: Promise<number> | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Addresses
  // ---------------------------------------------------------------------------------------------

  async list(tenantId: string): Promise<WebhookEndpointDto[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId))
      .orderBy(asc(webhookEndpoints.createdAt));
    const counts = rows.length
      ? await this.db
          .select({
            endpointId: webhookDeliveries.endpointId,
            status: webhookDeliveries.status,
            total: count(),
          })
          .from(webhookDeliveries)
          .where(
            and(
              inArray(
                webhookDeliveries.endpointId,
                rows.map((r) => r.id),
              ),
              inArray(webhookDeliveries.status, ['pending', 'sending', 'failed']),
            ),
          )
          .groupBy(webhookDeliveries.endpointId, webhookDeliveries.status)
      : [];
    return rows.map((row) => {
      const mine = counts.filter((c) => c.endpointId === row.id);
      const total = (statuses: string[]) =>
        mine.filter((c) => statuses.includes(c.status)).reduce((sum, c) => sum + c.total, 0);
      return toEndpointDto(row, total(['pending', 'sending']), total(['failed']));
    });
  }

  async create(
    tenantId: string,
    userId: string,
    body: CreateWebhookBody,
  ): Promise<CreatedWebhookDto> {
    await this.checkUrl(body.url);
    const secret = `whsec_${randomToken(24)}`;
    const endpoint = await this.db.transaction(async (tx) => {
      // One operator adding addresses from two tabs still stops at the limit.
      await tx.execute(sql`select id from tenants where id = ${tenantId} for update`);
      const [existing] = await tx
        .select({ total: count() })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.tenantId, tenantId));
      if ((existing?.total ?? 0) >= MAX_WEBHOOK_ENDPOINTS) {
        throw new DomainError('errors.webhooks.tooMany', HttpStatus.CONFLICT, undefined, {
          max: MAX_WEBHOOK_ENDPOINTS,
        });
      }
      const [row] = await tx
        .insert(webhookEndpoints)
        .values({
          tenantId,
          url: body.url,
          description: body.description ?? null,
          events: body.events ?? [],
          secretEncrypted: sealSecret(this.config.APP_SECRET, secret),
        })
        .returning();
      await this.audit(tx, tenantId, userId, 'webhook_created', row!.id, { url: body.url });
      return row!;
    });
    return { endpoint: toEndpointDto(endpoint, 0, 0), secret };
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    body: UpdateWebhookBody,
  ): Promise<WebhookEndpointDto> {
    const current = await this.endpoint(tenantId, id);
    if (body.url !== undefined && body.url !== current.url) await this.checkUrl(body.url);
    await this.db.transaction(async (tx) => {
      await tx
        .update(webhookEndpoints)
        .set({
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.events !== undefined ? { events: body.events } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(webhookEndpoints.id, id));
      await this.audit(tx, tenantId, userId, 'webhook_updated', id, body);
    });
    return (await this.list(tenantId)).find((e) => e.id === id)!;
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    const endpoint = await this.endpoint(tenantId, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
      await this.audit(tx, tenantId, userId, 'webhook_deleted', id, { url: endpoint.url });
    });
  }

  async secret(tenantId: string, id: string): Promise<string> {
    const endpoint = await this.endpoint(tenantId, id);
    return openSecret(this.config.APP_SECRET, endpoint.secretEncrypted);
  }

  /** Sends a sample booking right away, so the other side can be set up and checked. */
  async test(tenantId: string, id: string): Promise<WebhookTestResultDto> {
    const endpoint = await this.endpoint(tenantId, id);
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const now = this.clock.now();
    const payload: WebhookPayload = {
      id: randomUUID(),
      type: WEBHOOK_TEST_EVENT,
      createdAt: now.toISOString(),
      operator: { id: tenant!.id, slug: tenant!.slug, name: tenant!.name },
      data: { booking: sampleBooking(now, tenant!.currency) },
    };
    const started = Date.now();
    const result = await this.send(endpoint, payload);
    await this.recordAttempt(endpoint.id, result);
    return { ...result, durationMs: Date.now() - started };
  }

  async deliveries(tenantId: string, id: string): Promise<WebhookDeliveryDto[]> {
    await this.endpoint(tenantId, id);
    const rows = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(50);
    return rows.map(toDeliveryDto);
  }

  /** Queues an event again (after the other side was fixed); the worker sends it within seconds. */
  async retry(tenantId: string, id: string, deliveryId: string): Promise<WebhookDeliveryDto> {
    await this.endpoint(tenantId, id);
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: this.clock.now(), lastError: null })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.endpointId, id),
          inArray(webhookDeliveries.status, ['failed', 'pending']),
        ),
      )
      .returning();
    if (!row) throw new NotFound('webhookDelivery');
    return toDeliveryDto(row);
  }

  private async endpoint(tenantId: string, id: string): Promise<Endpoint> {
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.tenantId, tenantId)));
    if (!row) throw new NotFound('webhook');
    return row;
  }

  /** In production: https only, and never the platform's own network (see public-fetch.ts). */
  private async checkUrl(url: string): Promise<void> {
    if (this.config.NODE_ENV !== 'production') return;
    if (!url.startsWith('https://')) {
      throw new DomainError('errors.webhooks.httpsRequired', HttpStatus.BAD_REQUEST);
    }
    try {
      await assertPublicUrl(url);
    } catch {
      throw new DomainError('errors.webhooks.privateUrl', HttpStatus.BAD_REQUEST);
    }
  }

  private async audit(
    tx: DbOrTx,
    tenantId: string,
    userId: string,
    action: string,
    endpointId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId,
      actorUserId: userId,
      action,
      entityType: 'webhook_endpoint',
      entityId: endpointId,
      data,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------

  /**
   * Queues an event for every active address that wants it, in the caller's transaction. The
   * booking is read now, so retries send what was true when the event happened.
   */
  async enqueue(
    tx: DbOrTx,
    tenantId: string,
    type: WebhookEventType,
    bookingId: string,
    extra: Pick<WebhookPayload['data'], 'cancellation' | 'checkIn'> = {},
  ): Promise<void> {
    const endpoints = await tx
      .select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.active, true)));
    const targets = endpoints.filter((e) => e.events.length === 0 || e.events.includes(type));
    if (targets.length === 0) return;

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const booking = await bookingPayload(tx, bookingId);
    if (!tenant || !booking) return;
    const now = this.clock.now();
    const payload: WebhookPayload = {
      id: randomUUID(),
      type,
      createdAt: now.toISOString(),
      operator: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      data: { booking, ...extra },
    };
    await tx
      .insert(webhookDeliveries)
      .values(
        targets.map((endpoint) => ({
          tenantId,
          endpointId: endpoint.id,
          eventId: payload.id,
          eventType: type,
          payload,
          nextAttemptAt: now,
        })),
      )
      .onConflictDoNothing();
  }

  /** Sends every event that is due. Concurrent calls share one run. */
  deliverDue(): Promise<number> {
    if (!this.delivering) {
      this.delivering = this.deliverAll().finally(() => {
        this.delivering = null;
      });
    }
    return this.delivering;
  }

  /** Forgets old sent and abandoned events. */
  async prune(): Promise<void> {
    const before = new Date(this.clock.now().getTime() - KEEP_DAYS * 86_400_000);
    await this.db
      .delete(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.status, ['delivered', 'failed']),
          lt(webhookDeliveries.createdAt, before),
        ),
      );
  }

  private async deliverAll(): Promise<number> {
    let sent = 0;
    for (let round = 0; round < 40; round += 1) {
      const batch = await this.claim();
      if (!batch.length) break;
      for (const row of batch) {
        if (await this.deliverRow(row)) sent += 1;
      }
    }
    return sent;
  }

  /** Takes due events for this worker: concurrent workers never take the same one. */
  private async claim(): Promise<Delivery[]> {
    const now = this.clock.now();
    // A worker died after the last allowed attempt: give up on those.
    await this.db
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        lastError: sql`coalesce(${webhookDeliveries.lastError}, 'worker stopped while sending')`,
      })
      .where(
        and(
          eq(webhookDeliveries.status, 'sending'),
          sql`${webhookDeliveries.attempts} >= ${MAX_ATTEMPTS}`,
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      );
    const due = this.db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.status, ['pending', 'sending']),
          lte(webhookDeliveries.nextAttemptAt, now),
          lt(webhookDeliveries.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.createdAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    const claimed = await this.db
      .update(webhookDeliveries)
      .set({
        status: 'sending',
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(inArray(webhookDeliveries.id, due))
      .returning();
    // UPDATE ... RETURNING has no order: send events in the order they happened.
    return claimed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  private async deliverRow(row: Delivery): Promise<boolean> {
    const [endpoint] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, row.endpointId));
    if (!endpoint?.active) {
      await this.db
        .update(webhookDeliveries)
        .set({ status: 'failed', lastError: 'address turned off' })
        .where(eq(webhookDeliveries.id, row.id));
      return false;
    }

    const result = await this.send(endpoint, row.payload as WebhookPayload);
    await this.recordAttempt(endpoint.id, result);
    if (result.ok) {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: 'delivered',
          responseStatus: result.status,
          lastError: null,
          deliveredAt: this.clock.now(),
        })
        .where(eq(webhookDeliveries.id, row.id));
      return true;
    }

    // 410 Gone: the receiver says this address is closed for good (Zapier, when a Zap is
    // deleted). Stop sending to it; the operator can turn it back on.
    const gone = result.status === 410;
    if (gone) {
      await this.db
        .update(webhookEndpoints)
        .set({ active: false })
        .where(eq(webhookEndpoints.id, endpoint.id));
    }
    const final = gone || row.attempts >= MAX_ATTEMPTS;
    const wait = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
    this.logger.warn(
      `${row.eventType} ${row.eventId} to ${endpoint.url} failed (attempt ${row.attempts}${final ? ', giving up' : ''}): ${result.error}`,
    );
    await this.db
      .update(webhookDeliveries)
      .set({
        status: final ? 'failed' : 'pending',
        responseStatus: result.status,
        lastError: result.error,
        nextAttemptAt: new Date(this.clock.now().getTime() + (final ? 0 : wait)),
      })
      .where(eq(webhookDeliveries.id, row.id));
    return false;
  }

  private async recordAttempt(endpointId: string, result: SendResult): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set({
        lastAttemptAt: this.clock.now(),
        lastStatus: result.status,
        lastError: result.ok ? null : result.error,
      })
      .where(eq(webhookEndpoints.id, endpointId));
  }

  private async send(endpoint: Endpoint, payload: WebhookPayload): Promise<SendResult> {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(this.clock.now().getTime() / 1000);
    const secret = openSecret(this.config.APP_SECRET, endpoint.secretEncrypted);
    // In production the address must be on the public internet (checked again here, since DNS
    // can change after the address was saved).
    const fetchImpl = this.config.NODE_ENV === 'production' ? publicFetch : fetch;
    try {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'AffiliatePlatform-Webhooks/1.0',
          'x-webhook-id': payload.id,
          'x-webhook-event': payload.type,
          'x-webhook-timestamp': String(timestamp),
          'x-webhook-signature': webhookSignature(secret, timestamp, body),
        },
        body,
      });
      // The answer's body is not needed; drop it so the connection is freed.
      await response.body?.cancel().catch(() => undefined);
      return response.ok
        ? { ok: true, status: response.status, error: null }
        : { ok: false, status: response.status, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, status: null, error: failureReason(error) };
    }
  }
}

/** The booking as other software sees it; null when it no longer exists. */
async function bookingPayload(
  db: DbOrTx,
  bookingId: string,
): Promise<WebhookBookingPayload | null> {
  const [row] = await db
    .select({
      booking: bookings,
      productName: products.name,
      endsAt: slots.endsAt,
      affiliateName: affiliates.displayName,
    })
    .from(bookings)
    .innerJoin(products, eq(products.id, bookings.productId))
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .leftJoin(affiliates, eq(affiliates.id, bookings.affiliateId))
    .where(eq(bookings.id, bookingId));
  if (!row) return null;
  const items = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.code));
  const b = row.booking;
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    channel: b.channel,
    paymentMode: b.paymentMode,
    paid: b.paidAt !== null,
    paidAt: b.paidAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    trip: { id: b.productId, name: row.productName },
    startsAt: b.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    seats: b.seats,
    items: items.map((item) => ({
      code: item.code,
      label: item.label,
      quantity: item.quantity,
      unitAmount: amount(item.unitAmountMinor),
      unitAmountMinor: item.unitAmountMinor,
    })),
    customer: {
      name: b.customerName,
      email: b.customerEmail,
      phone: b.customerPhone,
      language: b.customerLocale,
      hotelRoom: b.hotelRoom,
    },
    currency: b.currency,
    total: amount(b.totalMinor),
    totalMinor: b.totalMinor,
    tax: amount(b.taxMinor),
    taxMinor: b.taxMinor,
    affiliate:
      b.affiliateId && row.affiliateName ? { id: b.affiliateId, name: row.affiliateName } : null,
    externalRef: b.externalRef,
  };
}

/** A made-up booking for "Send a test": same shape as a real one, clearly marked TEST. */
function sampleBooking(now: Date, currency: string): WebhookBookingPayload {
  const startsAt = new Date(now.getTime() + 2 * 86_400_000);
  return {
    id: '00000000-0000-4000-8000-000000000000',
    reference: 'TEST-0001',
    status: 'confirmed',
    channel: 'qr',
    paymentMode: 'online',
    paid: true,
    paidAt: now.toISOString(),
    createdAt: now.toISOString(),
    cancelledAt: null,
    trip: { id: '00000000-0000-4000-8000-000000000001', name: 'Test trip' },
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * 3_600_000).toISOString(),
    seats: 2,
    items: [
      { code: 'adult', label: 'Adult', quantity: 2, unitAmount: '100.00', unitAmountMinor: 10000 },
    ],
    customer: {
      name: 'Test Customer',
      email: 'customer@example.com',
      phone: '+40700000000',
      language: 'en',
      hotelRoom: null,
    },
    currency,
    total: '200.00',
    totalMinor: 20000,
    tax: '0.00',
    taxMinor: 0,
    affiliate: null,
    externalRef: null,
  };
}

function toEndpointDto(row: Endpoint, pending: number, failed: number): WebhookEndpointDto {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events as WebhookEndpointDto['events'],
    active: row.active,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    pending,
    failed,
  };
}

function toDeliveryDto(row: Delivery): WebhookDeliveryDto {
  return {
    id: row.id,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: row.status === 'pending' ? row.nextAttemptAt.toISOString() : null,
  };
}
