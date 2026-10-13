import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DbHandle,
  affiliates,
  bookings,
  commissionEntries,
  createDb,
  products,
  runMigrations,
  slots,
  tenants,
} from './index';

const url = process.env.TEST_DATABASE_URL;

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('expected the query to fail');
}

describe.skipIf(!url)('database schema (needs TEST_DATABASE_URL)', () => {
  let handle: DbHandle;
  let entryId: string;

  beforeAll(async () => {
    handle = createDb(url!, { max: 2 });
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`create schema public`);
    await runMigrations(handle);

    const { db } = handle;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug: 'delta-boats', name: 'Delta Boats' })
      .returning();
    const [affiliate] = await db
      .insert(affiliates)
      .values({ tenantId: tenant!.id, displayName: 'Ana, Hotel Central', status: 'active' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ tenantId: tenant!.id, slug: 'sunset', name: 'Sunset cruise', durationMinutes: 90 })
      .returning();
    const startsAt = new Date('2026-10-20T16:00:00Z');
    const [slot] = await db
      .insert(slots)
      .values({
        tenantId: tenant!.id,
        productId: product!.id,
        startsAt,
        endsAt: new Date('2026-10-20T17:30:00Z'),
        capacity: 20,
      })
      .returning();
    const [booking] = await db
      .insert(bookings)
      .values({
        tenantId: tenant!.id,
        reference: 'DB-0001',
        productId: product!.id,
        slotId: slot!.id,
        startsAt,
        channel: 'qr',
        affiliateId: affiliate!.id,
        customerName: 'John Smith',
        seats: 2,
        currency: 'RON',
        totalMinor: 20_000,
      })
      .returning();
    const [entry] = await db
      .insert(commissionEntries)
      .values({
        tenantId: tenant!.id,
        affiliateId: affiliate!.id,
        bookingId: booking!.id,
        periodKey: '2026-10',
        kind: 'sale',
        amountMinor: 3000,
        rateBps: 1500,
        baseMinor: 20_000,
        currency: 'RON',
        reason: 'sale #1',
        planSnapshot: { kind: 'fixed', rateBps: 1500, basis: 'gross' },
      })
      .returning();
    entryId = entry!.id;
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('lets a commission entry move forward from pending to approved to paid', async () => {
    await handle.db.execute(
      sql`update commission_entries set status = 'approved' where id = ${entryId}`,
    );
    await handle.db.execute(
      sql`update commission_entries set status = 'paid' where id = ${entryId}`,
    );
    const result = await handle.db.execute<{ status: string }>(
      sql`select status from commission_entries where id = ${entryId}`,
    );
    expect(result.rows[0]?.status).toBe('paid');
  });

  it('refuses to change the amount of a commission entry', async () => {
    expect(
      await pgError(
        handle.db.execute(
          sql`update commission_entries set amount_minor = 99999 where id = ${entryId}`,
        ),
      ),
    ).toMatch(/append-only/);
  });

  it('refuses to move a paid entry back to pending', async () => {
    expect(
      await pgError(
        handle.db.execute(
          sql`update commission_entries set status = 'pending' where id = ${entryId}`,
        ),
      ),
    ).toMatch(/cannot go from paid to pending/);
  });

  it('refuses to delete a commission entry', async () => {
    expect(
      await pgError(handle.db.execute(sql`delete from commission_entries where id = ${entryId}`)),
    ).toMatch(/append-only/);
  });

  it('allows only one sale entry per booking', async () => {
    expect(
      await pgError(
        handle.db.execute(sql`
        insert into commission_entries
          (tenant_id, affiliate_id, booking_id, period_key, kind, amount_minor, rate_bps, base_minor, currency, reason, plan_snapshot)
        select tenant_id, affiliate_id, booking_id, period_key, 'sale', 1, 1, 1, currency, 'duplicate', plan_snapshot
        from commission_entries where id = ${entryId}`),
      ),
    ).toMatch(/commission_entries_one_sale_per_booking/);
  });
});
