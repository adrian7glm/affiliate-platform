import type { OperatorAnalyticsDto } from '@ap/contracts';
import {
  affiliateLinks,
  affiliates,
  bookings,
  clicks,
  commissionEntries,
  commissionPlans,
  createDb,
  products,
  slots,
} from '@ap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The operator dashboard numbers, against rows written straight into the database so every edge
 * is controlled: days in the operator's timezone, channels, unpaid and cancelled bookings, the
 * fair comparison with last month, clicks and each affiliate's tier.
 */
describe.skipIf(!databaseUrl)('operator analytics (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  const ids = { ana: '', mihai: '', ion: '' };

  const get = (path: string) =>
    h.http.get(path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);

  beforeAll(async () => {
    // 12 October, 13:00 in Bucharest.
    h = await startHarness(databaseUrl!, '2026-10-12T10:00:00Z');
    owner = await signIn(h, h.ownerEmail);

    const { db, close } = createDb(databaseUrl!, { max: 1 });
    const tenantId = h.tenantId;
    await db.insert(commissionPlans).values({
      tenantId,
      name: 'Standard',
      kind: 'tiered',
      mode: 'marginal',
      tiers: [
        { fromSale: 1, rateBps: 1500 },
        { fromSale: 4, rateBps: 2000 },
        { fromSale: 11, rateBps: 2500 },
      ],
      isDefault: true,
    });
    const [ana, mihai, ion] = await db
      .insert(affiliates)
      .values([
        { tenantId, displayName: 'Ana, Hotel Central', status: 'active' },
        { tenantId, displayName: 'Mihai', status: 'active', commissionRateBpsOverride: 1000 },
        { tenantId, displayName: 'Ion', status: 'invited' },
      ])
      .returning();
    ids.ana = ana!.id;
    ids.mihai = mihai!.id;
    ids.ion = ion!.id;
    const [link] = await db
      .insert(affiliateLinks)
      .values({ tenantId, affiliateId: ana!.id, code: 'ANA1' })
      .returning();
    await db.insert(clicks).values([
      {
        tenantId,
        linkId: link!.id,
        affiliateId: ana!.id,
        visitorId: 'v1',
        occurredAt: new Date('2026-10-02T10:00:00Z'),
      },
      {
        tenantId,
        linkId: link!.id,
        affiliateId: ana!.id,
        visitorId: 'v2',
        occurredAt: new Date('2026-10-03T10:00:00Z'),
      },
      {
        tenantId,
        linkId: link!.id,
        affiliateId: ana!.id,
        visitorId: 'v2',
        occurredAt: new Date('2026-10-03T10:01:00Z'),
        counted: false,
      },
      {
        tenantId,
        linkId: link!.id,
        affiliateId: ana!.id,
        visitorId: 'v3',
        occurredAt: new Date('2026-09-30T10:00:00Z'),
      },
    ]);
    const [product] = await db
      .insert(products)
      .values({ tenantId, slug: 'cruise', name: 'Cruise', durationMinutes: 60 })
      .returning();
    const [slot] = await db
      .insert(slots)
      .values({
        tenantId,
        productId: product!.id,
        startsAt: new Date('2026-10-20T07:00:00Z'),
        endsAt: new Date('2026-10-20T08:00:00Z'),
        capacity: 50,
      })
      .returning();

    let n = 0;
    const booking = (
      paidAt: string | null,
      totalMinor: number,
      channel: 'qr' | 'link' | 'affiliate_assisted' | 'direct',
      affiliateId: string | null,
      status: 'confirmed' | 'cancelled' | 'pending_payment' = 'confirmed',
    ) => ({
      tenantId,
      reference: `R${(n += 1)}`,
      productId: product!.id,
      slotId: slot!.id,
      startsAt: slot!.startsAt,
      status,
      channel,
      affiliateId,
      customerName: 'Guest',
      seats: 2,
      currency: 'RON',
      totalMinor,
      paidAt: paidAt ? new Date(paidAt) : null,
    });
    const rows = await db
      .insert(bookings)
      .values([
        // 4 October 01:30 in Bucharest, still 3 October in UTC.
        booking('2026-10-03T22:30:00Z', 10_000, 'qr', ana!.id),
        booking('2026-10-04T09:00:00Z', 20_000, 'qr', ana!.id),
        booking('2026-10-05T09:00:00Z', 10_000, 'affiliate_assisted', ana!.id),
        booking('2026-10-06T09:00:00Z', 10_000, 'affiliate_assisted', ana!.id),
        booking('2026-10-06T10:00:00Z', 5_000, 'link', mihai!.id),
        booking('2026-10-07T09:00:00Z', 30_000, 'direct', null),
        // Not sales: cancelled, unpaid, and 1 November in Bucharest.
        booking('2026-10-07T10:00:00Z', 99_000, 'direct', null, 'cancelled'),
        booking(null, 99_000, 'qr', ana!.id, 'pending_payment'),
        booking('2026-10-31T22:30:00Z', 99_000, 'direct', null),
        // September: only the sale before the 12th is compared.
        booking('2026-09-05T09:00:00Z', 40_000, 'qr', ana!.id),
        booking('2026-09-20T09:00:00Z', 70_000, 'direct', null),
      ])
      .returning();

    const entry = (
      i: number,
      affiliateId: string,
      periodKey: string,
      status: 'pending' | 'approved' | 'paid',
      amountMinor: number,
    ) => ({
      tenantId,
      affiliateId,
      bookingId: rows[i]!.id,
      periodKey,
      kind: 'sale' as const,
      status,
      amountMinor,
      rateBps: 1500,
      baseMinor: rows[i]!.totalMinor,
      currency: 'RON',
      reason: 'sale',
      planSnapshot: {},
    });
    await db.insert(commissionEntries).values([
      entry(0, ana!.id, '2026-10', 'approved', 1_500),
      entry(1, ana!.id, '2026-10', 'pending', 3_000),
      entry(2, ana!.id, '2026-10', 'pending', 1_500),
      entry(3, ana!.id, '2026-10', 'pending', 2_000),
      entry(4, mihai!.id, '2026-10', 'pending', 500),
      // Approved in September and never paid: still owed.
      entry(9, ana!.id, '2026-09', 'approved', 6_000),
    ]);
    await close();
  });

  afterAll(async () => {
    await h?.close();
  });

  it('adds up the month in the operator timezone', async () => {
    const a = (await get('/operator/analytics').expect(200)).body as OperatorAnalyticsDto;
    expect(a).toMatchObject({
      periodKey: '2026-10',
      currency: 'RON',
      throughDate: '2026-10-12',
      totals: {
        bookings: 6,
        revenueMinor: 85_000,
        seats: 12,
        affiliateBookings: 5,
        affiliateRevenueMinor: 55_000,
        clicks: 2,
      },
      previous: { periodKey: '2026-09', throughDay: 12, bookings: 1, revenueMinor: 40_000 },
    });
    expect(a.daily).toHaveLength(31);
    expect(a.daily[2]).toEqual({
      date: '2026-10-03',
      bookings: 0,
      revenueMinor: 0,
      affiliateRevenueMinor: 0,
    });
    expect(a.daily[3]).toEqual({
      date: '2026-10-04',
      bookings: 2,
      revenueMinor: 30_000,
      affiliateRevenueMinor: 30_000,
    });
    expect(a.daily[6]).toMatchObject({
      date: '2026-10-07',
      revenueMinor: 30_000,
      affiliateRevenueMinor: 0,
    });
    expect(a.channels).toEqual([
      { channel: 'qr', bookings: 2, revenueMinor: 30_000 },
      { channel: 'link', bookings: 1, revenueMinor: 5_000 },
      { channel: 'affiliate_assisted', bookings: 2, revenueMinor: 20_000 },
      { channel: 'promo_code', bookings: 0, revenueMinor: 0 },
      { channel: 'direct', bookings: 1, revenueMinor: 30_000 },
    ]);
  });

  it('shows what is owed and where each affiliate stands in their tiers', async () => {
    const a = (await get('/operator/analytics?period=2026-10').expect(200))
      .body as OperatorAnalyticsDto;
    expect(a.commissions).toEqual({
      pendingMinor: 7_000,
      approvedMinor: 1_500,
      paidMinor: 0,
      totalMinor: 8_500,
      payableMinor: 7_500,
    });
    expect(a.affiliates.map((x) => x.name)).toEqual(['Ana, Hotel Central', 'Mihai']);
    expect(a.affiliates[0]).toMatchObject({
      affiliateId: ids.ana,
      paidSales: 4,
      salesMinor: 50_000,
      clicks: 2,
      commissionMinor: 8_000,
      payableMinor: 7_500,
      planKind: 'tiered',
      progress: { paidSales: 4, currentRateBps: 2000, nextRateBps: 2500, salesToNextTier: 7 },
    });
    expect(a.affiliates[1]).toMatchObject({
      affiliateId: ids.mihai,
      paidSales: 1,
      planKind: 'fixed',
      progress: { currentRateBps: 1000, nextRateBps: null },
    });
  });

  it('compares a closed month in full and refuses months that have not started', async () => {
    const september = (await get('/operator/analytics?period=2026-09').expect(200))
      .body as OperatorAnalyticsDto;
    expect(september).toMatchObject({
      throughDate: '2026-09-30',
      totals: { bookings: 2, revenueMinor: 110_000, clicks: 1 },
      previous: { periodKey: '2026-08', throughDay: 31 },
    });
    expect(september.daily).toHaveLength(30);
    await get('/operator/analytics?period=2026-11').expect(400);
    await get('/operator/analytics?period=oct').expect(400);
  });
});
