import type { CheckoutResultDto, ProductDto, SlotDto, TicketDto } from '@ap/contracts';
import { type Database, bookings, createDb, notifications, otpCodes } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BookingService } from '../src/booking/booking.service';
import type { DomainError } from '../src/common/errors';
import { IdentityService } from '../src/identity/identity.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * Money and abuse edge cases: a payment that arrives after its seats were given away, a payment
 * racing a cancellation, many login guesses at once, and operators sending messages in bulk.
 */
describe.skipIf(!databaseUrl)('payment races and sending limits (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let product: ProductDto;

  const asOwner = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;

  async function slotOn(date: string): Promise<SlotDto> {
    const listed = await h.http
      .get(`/public/tenants/delta-boats/products/kayak/slots?from=${date}&to=${date}`)
      .expect(200);
    return (listed.body as SlotDto[])[0]!;
  }

  async function book(slot: SlotDto, seats: number, email: string): Promise<CheckoutResultDto> {
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: product.prices[0]!.id, quantity: seats }],
        acceptTerms: true,
        customer: { name: 'Tourist', email, locale: 'en' },
      })
      .expect(201);
    return response.body as CheckoutResultDto;
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function ticket(result: CheckoutResultDto): Promise<TicketDto> {
    const response = await h.http
      .get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`)
      .expect(200);
    return response.body as TicketDto;
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    const created = await asOwner('post', '/operator/products')
      .send({
        name: 'Kayak tour',
        slug: 'kayak',
        durationMinutes: 60,
        prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
      })
      .expect(201);
    product = created.body as ProductDto;
    await asOwner('post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-10-09', times: ['10:00'], capacity: 4 })
      .expect(201);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('refunds a late payment whose seats were sold meanwhile, instead of overbooking', async () => {
    h.clock.set('2026-10-05T08:00:00Z');
    const slot = await slotOn('2026-10-06');
    const late = await book(slot, 2, 'late@example.com');
    h.clock.set('2026-10-05T08:31:00Z');
    expect(await h.app.get(BookingService).expireUnpaid()).toBe(1);
    await pay(await book(slot, 4, 'group@example.com'));
    const refundsBefore = h.payments.refunds.length;

    await pay(late);

    expect((await ticket(late)).status).toBe('void');
    expect(h.payments.refunds.length).toBe(refundsBefore + 1);
    expect(h.payments.refunds.at(-1)!.amountMinor).toBe(20_000);
    expect((await slotOn('2026-10-06')).available).toBe(0);
    const passengers = await asOwner('get', `/operator/departures/${slot.id}/passengers`).expect(
      200,
    );
    expect(JSON.stringify(passengers.body)).not.toContain('late@example.com');
    expect((await h.lastMessage('late@example.com'))?.text).toBeTruthy();
  });

  it('refunds a late payment for a departure called off while the customer was paying', async () => {
    h.clock.set('2026-10-05T09:00:00Z');
    const slot = await slotOn('2026-10-07');
    const late = await book(slot, 2, 'storm@example.com');
    h.clock.set('2026-10-05T09:31:00Z');
    await h.app.get(BookingService).expireUnpaid();
    await asOwner('post', `/operator/products/${product.id}/slots/cancel`)
      .send({ slotIds: [slot.id], reason: 'weather' })
      .expect(200);
    const refundsBefore = h.payments.refunds.length;

    await pay(late);

    expect((await ticket(late)).status).toBe('void');
    expect(h.payments.refunds.length).toBe(refundsBefore + 1);
  });

  it('still honours a late payment when its seats are free', async () => {
    h.clock.set('2026-10-05T10:00:00Z');
    const slot = await slotOn('2026-10-08');
    const late = await book(slot, 2, 'slow@example.com');
    h.clock.set('2026-10-05T10:31:00Z');
    await h.app.get(BookingService).expireUnpaid();
    await pay(late);
    expect((await ticket(late)).status).toBe('valid');
    expect((await slotOn('2026-10-08')).available).toBe(2);
  });

  it('refunds when the payment lands while the operator is cancelling the booking', async () => {
    h.clock.set('2026-10-05T11:00:00Z');
    const slot = await slotOn('2026-10-09');
    const pending = await book(slot, 1, 'race@example.com');
    const service = h.app.get(BookingService);
    const db = (service as unknown as { db: { transaction: (...args: unknown[]) => unknown } }).db;
    const original = db.transaction.bind(db);
    let paidInBetween = false;
    const spy = vi.spyOn(db, 'transaction').mockImplementation(async (...args: unknown[]) => {
      if (!paidInBetween) {
        paidInBetween = true;
        // The payment commits after cancel() read the booking as unpaid, before it locks it.
        await service.confirmPayment(pending.booking.id, 'pi_race');
      }
      return original(...args);
    });
    const refundsBefore = h.payments.refunds.length;
    try {
      await service.cancel(h.tenantId, pending.booking.id, 'customer asked', null);
    } finally {
      spy.mockRestore();
    }
    const handle = createDb(databaseUrl!, { max: 1 });
    const [row] = await handle.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, pending.booking.id));
    await handle.close();
    expect(row!.status).toBe('refunded');
    expect(h.payments.refunds.slice(refundsBefore)).toEqual([
      { paymentIntentId: 'pi_race', amountMinor: 10_000 },
    ]);
  });

  it('gives a login code only 5 guesses, even when they are sent all at once', async () => {
    const destination = 'guess@example.com';
    await h.http.post('/auth/otp/request').send({ destination }).expect(204);
    const code = /(\d{6})/.exec(h.messages.last(destination)?.text ?? '')![1]!;
    const wrong = code === '000000' ? '111111' : '000000';

    // Hold every guess right after it has looked the code up, until all 20 have, so they all
    // see the same attempt count: the worst case for a check-then-count implementation.
    const guesses = 20;
    const identity = h.app.get(IdentityService);
    const db = (identity as unknown as { db: Database }).db;
    const originalSelect = db.select.bind(db);
    let waiting = 0;
    let release!: () => void;
    const allRead = new Promise<void>((resolve) => (release = resolve));
    const spy = vi.spyOn(db, 'select').mockImplementation(((
      ...args: Parameters<Database['select']>
    ) => {
      const builder = originalSelect(...args);
      const from = builder.from.bind(builder);
      builder.from = ((table: unknown) => {
        const query = from(table as typeof otpCodes);
        if (table !== otpCodes) return query;
        const limit = query.limit.bind(query);
        query.limit = ((n: number) => {
          const rows = limit(n);
          return {
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              rows
                .then(async (found: unknown) => {
                  if (++waiting === guesses) release();
                  await allRead;
                  return found;
                })
                .then(resolve, reject),
          };
        }) as typeof query.limit;
        return query;
      }) as typeof builder.from;
      return builder;
    }) as Database['select']);
    let results: PromiseSettledResult<void>[];
    try {
      results = await Promise.allSettled(
        Array.from({ length: guesses }, () => identity.consumeOtp(destination, wrong)),
      );
    } finally {
      spy.mockRestore();
    }
    const codes = results.map((r) =>
      r.status === 'rejected' ? (r.reason as DomainError).code : 'ok',
    );
    expect(codes.filter((c) => c === 'errors.auth.wrongCode')).toHaveLength(5);
    expect(codes.filter((c) => c === 'errors.auth.codeExpired')).toHaveLength(guesses - 5);

    const right = await h.http.post('/auth/otp/verify').send({ destination, code });
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('errors.auth.codeExpired');
  });

  it('caps the invitations an operator can send in a day', async () => {
    const handle = createDb(databaseUrl!, { max: 1 });
    await handle.db.insert(notifications).values(
      Array.from({ length: 50 }, (_, i) => ({
        tenantId: h.tenantId,
        channel: 'sms' as const,
        recipient: `+4072200${String(i).padStart(4, '0')}`,
        template: 'scanner_invite',
        locale: 'en',
        createdAt: new Date('2026-10-05T11:00:00Z'),
      })),
    );
    await handle.close();
    h.clock.set('2026-10-05T12:00:00Z');

    const refused = await asOwner('post', '/operator/scanners')
      .send({ name: 'Deckhand', destination: '+40722999999' })
      .expect(429);
    expect(refused.body.code).toBe('errors.limits.dailyMessages');
    await asOwner('post', '/operator/affiliates')
      .send({ displayName: 'Hotel', destination: '+40722999998' })
      .expect(429);

    // A day later the allowance is back.
    h.clock.set('2026-10-06T11:30:00Z');
    await asOwner('post', '/operator/scanners')
      .send({ name: 'Deckhand', destination: '+40722999999' })
      .expect(201);
  });
});
