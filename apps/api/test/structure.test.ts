import {
  affiliateLinks,
  affiliates,
  bookings,
  clicks,
  commissionEntries,
  createDb,
  otpCodes,
  outboxEvents,
  products,
  slots,
} from '@ap/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommissionLedgerService } from '../src/commissions/ledger.service';
import { CleanupService } from '../src/jobs/cleanup.service';
import { JOBS, type JobName, recordHeartbeat } from '../src/jobs/jobs';
import { MAX_ATTEMPTS } from '../src/outbox/outbox';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The fixes from the structure review: commission approval at volume, 64-bit totals, internal
 * events that stop being retried, the worker's health and the clean-up of old rows.
 */
describe.skipIf(!databaseUrl)('structure fixes (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let admin: string;
  let db: ReturnType<typeof createDb>['db'];
  let closeDb: () => Promise<void>;
  const ids = { affiliate: '', product: '', slot: '', link: '' };
  const ADMIN = 'admin@platform.test';

  const asOwner = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const asAdmin = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${admin}`);

  beforeAll(async () => {
    // 12 October 2026, 13:00 in Bucharest.
    h = await startHarness(databaseUrl!, '2026-10-12T10:00:00Z', {
      PLATFORM_ADMIN_EMAILS: ADMIN,
    });
    owner = await signIn(h, h.ownerEmail);
    admin = await signIn(h, ADMIN);
    ({ db, close: closeDb } = createDb(databaseUrl!, { max: 2 }));
    const tenantId = h.tenantId;
    const [affiliate] = await db
      .insert(affiliates)
      .values({ tenantId, displayName: 'Ana', status: 'active' })
      .returning();
    const [link] = await db
      .insert(affiliateLinks)
      .values({ tenantId, affiliateId: affiliate!.id, code: 'ANA1' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ tenantId, slug: 'cruise', name: 'Cruise', durationMinutes: 60 })
      .returning();
    const [slot] = await db
      .insert(slots)
      .values({
        tenantId,
        productId: product!.id,
        startsAt: new Date('2026-11-20T07:00:00Z'),
        endsAt: new Date('2026-11-20T08:00:00Z'),
        capacity: 50,
      })
      .returning();
    ids.affiliate = affiliate!.id;
    ids.product = product!.id;
    ids.slot = slot!.id;
    ids.link = link!.id;
  });

  afterAll(async () => {
    await closeDb?.();
    await h?.close();
  });

  /** `count` confirmed bookings paid on 10 October, each with a pending `sale` entry. */
  async function salesWithPendingCommission(
    prefix: string,
    count: number,
    startsAt: string,
    totalMinor = 10_000,
  ): Promise<void> {
    await db.execute(sql`
      insert into bookings (tenant_id, reference, product_id, slot_id, starts_at, status, channel,
                            affiliate_id, customer_name, seats, currency, total_minor, paid_at)
      select ${h.tenantId}, ${prefix} || g, ${ids.product}, ${ids.slot}, ${new Date(startsAt)},
             'confirmed', 'qr', ${ids.affiliate}, 'Guest', 1, 'RON', ${totalMinor},
             ${new Date('2026-10-10T09:00:00Z')}
      from generate_series(1, ${count}) g`);
    await db.execute(sql`
      insert into commission_entries (tenant_id, affiliate_id, booking_id, period_key, kind,
                                      amount_minor, rate_bps, base_minor, currency, reason,
                                      plan_snapshot)
      select tenant_id, affiliate_id, id, '2026-10', 'sale', total_minor / 10, 1000, total_minor,
             'RON', 'test', '{"kind":"fixed","rateBps":1000,"basis":"gross"}'::jsonb
      from bookings where reference like ${`${prefix}%`}`);
  }

  it('approves due commissions even behind thousands of pending ones for future trips', async () => {
    // More future-trip entries than the old job ever looked at (it read 5000, in no order).
    await salesWithPendingCommission('FUT', 5_100, '2026-11-20T07:00:00Z');
    // Two trips that happened 3 days ago: their commissions are due (24 h grace).
    await salesWithPendingCommission('PAST', 2, '2026-10-09T07:00:00Z');

    const approved = await h.app.get(CommissionLedgerService).approveDue();
    expect(approved).toBe(2);
    const statuses = await db
      .select({
        past: sql<number>`count(*) filter (where ${bookings.reference} like 'PAST%')::int`,
        future: sql<number>`count(*) filter (where ${bookings.reference} like 'FUT%')::int`,
        status: commissionEntries.status,
      })
      .from(commissionEntries)
      .innerJoin(bookings, eq(bookings.id, commissionEntries.bookingId))
      .groupBy(commissionEntries.status);
    expect(statuses.find((s) => s.status === 'approved')).toMatchObject({ past: 2, future: 0 });
    expect(statuses.find((s) => s.status === 'pending')).toMatchObject({ past: 0, future: 5_100 });
    // Nothing more is due: a second run approves nothing.
    expect(await h.app.get(CommissionLedgerService).approveDue()).toBe(0);
  });

  it('adds up totals past the 32-bit limit', async () => {
    // Two bookings of 15 million RON each: 3 billion bani, more than a 32-bit integer holds.
    await salesWithPendingCommission('BIG', 2, '2026-11-20T07:00:00Z', 1_500_000_000);
    const dashboard = await asOwner('get', '/operator/dashboard').expect(200);
    expect(dashboard.body.bookings.revenueMinor).toBe(5_102 * 10_000 + 3_000_000_000);
    const report = await asOwner('get', '/operator/commissions/report?period=2026-10').expect(200);
    expect(report.body.totals.salesMinor).toBe(5_102 * 10_000 + 3_000_000_000);
    await asOwner('get', '/operator/analytics?period=2026-10').expect(200);
    await asAdmin('get', '/admin/overview?period=2026-10').expect(200);
  });

  describe('internal events that keep failing', () => {
    let failing = true;
    const event = {
      type: 'ticket.checked_in' as const,
      ticketId: '00000000-0000-4000-8000-000000000001',
      bookingId: '00000000-0000-4000-8000-000000000002',
      checkedInAt: '2026-10-12T10:00:00.000Z',
    };

    beforeAll(() => {
      h.outbox.on('ticket.checked_in', 'test.flaky', async () => {
        if (failing) throw new Error('operator system down');
      });
    });

    it('waits longer after each failure instead of retrying at once', async () => {
      await h.outbox.publish(db, { ...event, tenantId: h.tenantId });
      await h.outbox.drain();
      const [row] = await db
        .select()
        .from(outboxEvents)
        .orderBy(sql`id desc`)
        .limit(1);
      expect(row).toMatchObject({ attempts: 1, processedAt: null });
      expect(row!.nextAttemptAt?.toISOString()).toBe('2026-10-12T10:00:05.000Z');

      // Not due yet: nothing happens.
      await h.outbox.drain();
      const [same] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, row!.id));
      expect(same!.attempts).toBe(1);

      h.clock.set('2026-10-12T10:00:06Z');
      await h.outbox.drain();
      const [second] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, row!.id));
      expect(second!.attempts).toBe(2);
      expect(second!.nextAttemptAt?.toISOString()).toBe('2026-10-12T10:00:16.000Z');
    });

    it('stops after the last attempt, emails the admins and can be retried from the admin area', async () => {
      const [row] = await db
        .select()
        .from(outboxEvents)
        .orderBy(sql`id desc`)
        .limit(1);
      await db
        .update(outboxEvents)
        .set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: null })
        .where(eq(outboxEvents.id, row!.id));
      await h.outbox.drain();

      const alert = await h.lastMessage(ADMIN);
      expect(alert?.subject).toContain('ticket.checked_in');
      expect(alert?.text).toContain('operator system down');
      expect(alert?.html).toContain('http://web.test/admin/system');

      const system = await asAdmin('get', '/admin/system').expect(200);
      expect(system.body.deadEvents).toEqual([
        expect.objectContaining({
          id: row!.id,
          type: 'ticket.checked_in',
          tenantName: 'Delta Boats',
          attempts: MAX_ATTEMPTS,
          lastError: 'test.flaky: operator system down',
        }),
      ]);
      await asOwner('get', '/admin/system').expect(403);

      failing = false;
      const retried = await asAdmin('post', `/admin/system/events/${row!.id}/retry`).expect(200);
      expect(retried.body.deadEvents).toEqual([]);
      await h.outbox.drain();
      const [done] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, row!.id));
      expect(done!.processedAt).not.toBeNull();
      await asAdmin('post', '/admin/system/events/999999/retry').expect(404);
    });
  });

  it('tells monitoring whether the background worker runs', async () => {
    const unknown = await h.http.get('/health/worker').expect(503);
    expect(unknown.body.status).toBe('unknown');

    const now = h.clock.now();
    for (const job of Object.keys(JOBS) as JobName[]) await recordHeartbeat(db, job, now, null);
    await h.http.get('/health/worker').expect(200);
    const system = await asAdmin('get', '/admin/system').expect(200);
    expect(system.body.worker.status).toBe('ok');

    // An hour without the outbox running: the worker stopped.
    h.clock.set(new Date(now.getTime() + 60 * 60_000).toISOString());
    const stale = await h.http.get('/health/worker').expect(503);
    expect(stale.body.stale).toContain('outbox');
    await h.http.get('/health').expect(200);
  });

  it('deletes rows that are no longer needed and keeps the rest', async () => {
    h.clock.set('2026-10-12T10:00:00Z');
    const day = 86_400_000;
    const ago = (days: number) => new Date(h.clock.now().getTime() - days * day);
    await db.insert(otpCodes).values([
      { destination: 'old@x.test', codeHash: 'x', expiresAt: ago(2), createdAt: ago(2) },
      { destination: 'new@x.test', codeHash: 'x', expiresAt: ago(0), createdAt: ago(0) },
    ]);
    await db.insert(clicks).values([
      {
        tenantId: h.tenantId,
        linkId: ids.link,
        affiliateId: ids.affiliate,
        visitorId: 'old',
        occurredAt: ago(500),
      },
      {
        tenantId: h.tenantId,
        linkId: ids.link,
        affiliateId: ids.affiliate,
        visitorId: 'recent',
        occurredAt: ago(30),
      },
    ]);
    await db.insert(outboxEvents).values([
      { type: 'x', payload: {}, processedAt: ago(40) },
      { type: 'x', payload: {}, processedAt: ago(1) },
      // Never processed: kept whatever its age.
      { type: 'x', payload: {}, occurredAt: ago(100), attempts: MAX_ATTEMPTS },
    ]);

    const deleted = await h.app.get(CleanupService).run();
    expect(deleted).toMatchObject({ loginCodes: 1, clicks: 1, processedEvents: 1 });
    const left = await db.execute<{ otp: number; clicks: number; events: number }>(sql`
      select (select count(*) from otp_codes where destination like '%@x.test')::int as otp,
             (select count(*) from clicks)::int as clicks,
             (select count(*) from outbox_events where type = 'x')::int as events`);
    expect(left.rows[0]).toEqual({ otp: 1, clicks: 1, events: 2 });
  });
});
