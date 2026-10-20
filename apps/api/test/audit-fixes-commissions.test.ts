import type { EventOfType } from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  commissionEntries,
  commissionPlans,
  payouts,
  products,
  slots,
} from '@ap/db';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommissionLedgerService } from '../src/commissions/ledger.service';
import { CommissionPayoutsService } from '../src/commissions/payouts.service';
import { DB, type Tx } from '../src/database/database.module';
import { type Harness, databaseUrl, startHarness } from './harness';

/**
 * A cancellation and month close touching the same booking, in every order (and at the same
 * time), and a confirmation handled after the cancellation: the cancelled booking must always
 * net to zero, nothing may stay pending forever, and the affiliate's other earnings are paid.
 */
describe.skipIf(!databaseUrl)('commission ledger orderings (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let db: Database;
  let ledger: CommissionLedgerService;
  let close: CommissionPayoutsService;
  let productId: string;
  let slotId: string;
  let counter = 0;

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-12T10:00:00Z');
    db = h.app.get(DB);
    ledger = h.app.get(CommissionLedgerService);
    close = h.app.get(CommissionPayoutsService);
    await db.insert(commissionPlans).values({
      tenantId: h.tenantId,
      name: 'Flat 10%',
      kind: 'fixed',
      rateBps: 1000,
      isDefault: true,
    });
    const [product] = await db
      .insert(products)
      .values({ tenantId: h.tenantId, slug: 'cruise', name: 'Cruise', durationMinutes: 60 })
      .returning();
    const [slot] = await db
      .insert(slots)
      .values({
        tenantId: h.tenantId,
        productId: product!.id,
        startsAt: new Date('2026-05-01T07:00:00Z'),
        endsAt: new Date('2026-05-01T08:00:00Z'),
        capacity: 999,
      })
      .returning();
    productId = product!.id;
    slotId = slot!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  async function newAffiliate(): Promise<string> {
    const [affiliate] = await db
      .insert(affiliates)
      .values({ tenantId: h.tenantId, displayName: `Hotel ${++counter}`, status: 'active' })
      .returning();
    return affiliate!.id;
  }

  const confirmed = (
    affiliateId: string,
    bookingId: string,
    paidAt: string,
  ): EventOfType<'booking.confirmed'> => ({
    type: 'booking.confirmed',
    tenantId: h.tenantId,
    bookingId,
    affiliateId,
    paidAt,
    totalMinor: 10_000,
    taxMinor: 0,
    currency: 'RON',
  });

  const cancelled = (affiliateId: string, bookingId: string): EventOfType<'booking.cancelled'> => ({
    type: 'booking.cancelled',
    tenantId: h.tenantId,
    bookingId,
    affiliateId,
    reason: 'guest ill',
    refunded: true,
  });

  /** A paid booking (trip already over) whose sale goes through the booking.confirmed handler. */
  async function paidBooking(affiliateId: string, paidAt: string, recordSale = true) {
    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId: h.tenantId,
        reference: `CM${++counter}`,
        productId,
        slotId,
        startsAt: new Date(paidAt),
        status: 'confirmed',
        channel: 'qr',
        affiliateId,
        customerName: 'Guest',
        seats: 1,
        currency: 'RON',
        totalMinor: 10_000,
        paidAt: new Date(paidAt),
      } as typeof bookings.$inferInsert)
      .returning();
    if (recordSale) await recordSaleOf(affiliateId, booking!.id, paidAt);
    return booking!.id;
  }

  const recordSaleOf = (affiliateId: string, bookingId: string, paidAt: string) =>
    db.transaction((tx) => ledger.recordSale(confirmed(affiliateId, bookingId, paidAt), tx));
  const reverse = (affiliateId: string, bookingId: string) =>
    db.transaction((tx) => ledger.reverse(cancelled(affiliateId, bookingId), tx));
  const cancel = (bookingId: string) =>
    db
      .update(bookings)
      .set({ status: 'refunded', cancelledAt: new Date() })
      .where(eq(bookings.id, bookingId));

  const entriesOf = (bookingId: string) =>
    db
      .select({
        kind: commissionEntries.kind,
        amountMinor: commissionEntries.amountMinor,
        status: commissionEntries.status,
      })
      .from(commissionEntries)
      .where(eq(commissionEntries.bookingId, bookingId))
      .orderBy(asc(commissionEntries.createdAt));
  const netOf = async (bookingId: string) =>
    (await entriesOf(bookingId)).reduce((sum, e) => sum + e.amountMinor, 0);
  const payoutsOf = async (affiliateId: string) =>
    (await db.select().from(payouts).where(eq(payouts.affiliateId, affiliateId))).map(
      (p) => p.amountMinor,
    );

  /** The cancelled booking nets to zero with nothing left pending; the good sale is paid out. */
  async function expectSettled(affiliateId: string, cancelledId: string, goodId: string) {
    expect(await netOf(cancelledId)).toBe(0);
    expect((await entriesOf(cancelledId)).filter((e) => e.status === 'pending')).toEqual([]);
    expect(await entriesOf(goodId)).toEqual([
      { kind: 'sale', amountMinor: 1000, status: 'approved' },
    ]);
    expect(await payoutsOf(affiliateId)).toEqual([1000]);
  }

  /** Holds the transaction's first UPDATE until `gate` opens; `reached` fires when it gets there. */
  function holdFirstUpdate(tx: Tx, reached: () => void, gate: Promise<void>): Tx {
    const held = <T extends object>(builder: T): T =>
      new Proxy(builder, {
        get(target, prop) {
          const value = Reflect.get(target, prop) as unknown;
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              gate.then(() => (target as PromiseLike<unknown>).then(resolve, reject));
          }
          return typeof value === 'function'
            ? (...args: unknown[]) =>
                held((value as (...a: unknown[]) => object).apply(target, args))
            : value;
        },
      });
    return new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (prop === 'update') {
          return (...args: Parameters<Tx['update']>) => {
            reached();
            return held(target.update(...args));
          };
        }
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    });
  }

  it('a cancellation racing month close cancels the sale once', async () => {
    const affiliateId = await newAffiliate();
    const good = await paidBooking(affiliateId, '2026-06-05T09:00:00Z');
    const lost = await paidBooking(affiliateId, '2026-06-10T09:00:00Z');
    await cancel(lost);

    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let reached!: () => void;
    const balanceRead = new Promise<void>((resolve) => (reached = resolve));
    // The cancellation reads the +1000 balance, then waits before writing its reversal.
    const reversing = db.transaction((tx) =>
      ledger.reverse(cancelled(affiliateId, lost), holdFirstUpdate(tx, reached, gate)),
    );
    await balanceRead;
    const closing = close.closePeriod(h.tenantId, '2026-06');
    await new Promise((resolve) => setTimeout(resolve, 300));
    open();
    await Promise.all([reversing, closing]);

    await expectSettled(affiliateId, lost, good);
  });

  it('month close before the cancellation is handled leaves no sale pending', async () => {
    const affiliateId = await newAffiliate();
    const good = await paidBooking(affiliateId, '2026-07-05T09:00:00Z');
    const lost = await paidBooking(affiliateId, '2026-07-10T09:00:00Z');
    await cancel(lost);

    // The booking.cancelled event is delayed (retry) until after the month was closed.
    const result = await close.closePeriod(h.tenantId, '2026-07');
    expect(result.adjustmentsCreated).toBe(1);
    await reverse(affiliateId, lost);

    await expectSettled(affiliateId, lost, good);
  });

  it('the cancellation handled before month close needs no adjustment', async () => {
    const affiliateId = await newAffiliate();
    const good = await paidBooking(affiliateId, '2026-08-05T09:00:00Z');
    const lost = await paidBooking(affiliateId, '2026-08-10T09:00:00Z');
    await cancel(lost);
    await reverse(affiliateId, lost);

    const result = await close.closePeriod(h.tenantId, '2026-08');
    expect(result.adjustmentsCreated).toBe(0);

    await expectSettled(affiliateId, lost, good);
  });

  it('a confirmation handled after the cancellation earns nothing', async () => {
    const affiliateId = await newAffiliate();
    const good = await paidBooking(affiliateId, '2026-09-05T09:00:00Z');
    // Its booking.confirmed handler failed and is retried after the booking was cancelled.
    const lost = await paidBooking(affiliateId, '2026-09-10T09:00:00Z', false);
    await cancel(lost);
    await reverse(affiliateId, lost);
    await recordSaleOf(affiliateId, lost, '2026-09-10T09:00:00Z');
    expect(await entriesOf(lost)).toEqual([]);

    await close.closePeriod(h.tenantId, '2026-09');
    expect(await entriesOf(lost)).toEqual([]);
    expect(await entriesOf(good)).toEqual([
      { kind: 'sale', amountMinor: 1000, status: 'approved' },
    ]);
    expect(await payoutsOf(affiliateId)).toEqual([1000]);
  });
});
