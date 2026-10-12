import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CommissionPlan,
  effectivePlan,
  periodKeyFor,
  periodRange,
  previousPeriod,
  tierProgress,
} from '@ap/commission';
import type { BookingChannel, OperatorAnalyticsDto } from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  clicks,
  commissionEntries,
  commissionPlans,
} from '@ap/db';
import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock';
import { DomainError } from '../common/errors';
import type { Tenant } from '../common/tenants';
import { planFromRow } from '../commissions/commissions.service';
import { DB } from '../database/database.module';

/** Fixed display order: the affiliate channels first, then the operator's own. */
export const CHANNELS: BookingChannel[] = [
  'qr',
  'link',
  'affiliate_assisted',
  'promo_code',
  'direct',
];

const NO_PLAN: CommissionPlan = { kind: 'fixed', rateBps: 0, basis: 'gross' };

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async month(tenant: Tenant, periodKey: string): Promise<OperatorAnalyticsDto> {
    const tz = tenant.timezone;
    const now = this.clock.now();
    if (periodKey > periodKeyFor(now, tz)) {
      throw new DomainError('errors.period.future', HttpStatus.BAD_REQUEST);
    }
    const { start, end } = periodRange(periodKey, tz);
    const first = DateTime.fromJSDate(start, { zone: tz });
    const daysInMonth = first.daysInMonth ?? 31;
    const isCurrent = now < end;
    const throughDay = isCurrent ? DateTime.fromJSDate(now, { zone: tz }).day : daysInMonth;

    const paidIn = (from: Date, to: Date) =>
      and(
        eq(bookings.tenantId, tenant.id),
        eq(bookings.status, 'confirmed'),
        gte(bookings.paidAt, from),
        lt(bookings.paidAt, to),
      );
    const affiliateRevenue = sql<number>`coalesce(sum(${bookings.totalMinor}) filter (where ${bookings.affiliateId} is not null), 0)::int`;
    const day = sql<string>`to_char(${bookings.paidAt} at time zone ${tz}, 'YYYY-MM-DD')`;

    const [byDay, byChannel, previous, clickRows, entryRows, payableRows, affiliateRows, planRows] =
      await Promise.all([
        this.db
          .select({
            date: day,
            bookings: sql<number>`count(*)::int`,
            seats: sql<number>`coalesce(sum(${bookings.seats}), 0)::int`,
            revenueMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
            affiliateBookings: sql<number>`(count(*) filter (where ${bookings.affiliateId} is not null))::int`,
            affiliateRevenueMinor: affiliateRevenue,
          })
          .from(bookings)
          .where(paidIn(start, end))
          // By position: the timezone is a bind parameter, so the expression would not match.
          .groupBy(sql`1`),
        this.db
          .select({
            channel: bookings.channel,
            bookings: sql<number>`count(*)::int`,
            revenueMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
          })
          .from(bookings)
          .where(paidIn(start, end))
          .groupBy(bookings.channel),
        // A finished month is compared with the whole month before it.
        this.previousMonth(tenant, periodKey, isCurrent ? throughDay : 31, paidIn),
        this.db
          .select({ affiliateId: clicks.affiliateId, count: sql<number>`count(*)::int` })
          .from(clicks)
          .where(
            and(
              eq(clicks.tenantId, tenant.id),
              eq(clicks.counted, true),
              gte(clicks.occurredAt, start),
              lt(clicks.occurredAt, end),
            ),
          )
          .groupBy(clicks.affiliateId),
        this.db
          .select({
            affiliateId: commissionEntries.affiliateId,
            status: commissionEntries.status,
            total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int`,
          })
          .from(commissionEntries)
          .where(
            and(
              eq(commissionEntries.tenantId, tenant.id),
              eq(commissionEntries.periodKey, periodKey),
            ),
          )
          .groupBy(commissionEntries.affiliateId, commissionEntries.status),
        this.db
          .select({
            affiliateId: commissionEntries.affiliateId,
            total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int`,
          })
          .from(commissionEntries)
          .where(
            and(
              eq(commissionEntries.tenantId, tenant.id),
              eq(commissionEntries.status, 'approved'),
            ),
          )
          .groupBy(commissionEntries.affiliateId),
        this.db.select().from(affiliates).where(eq(affiliates.tenantId, tenant.id)),
        this.db.select().from(commissionPlans).where(eq(commissionPlans.tenantId, tenant.id)),
      ]);

    const sales = await this.db
      .select({
        affiliateId: bookings.affiliateId,
        paidSales: sql<number>`count(*)::int`,
        salesMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .where(and(paidIn(start, end), isNotNull(bookings.affiliateId)))
      .groupBy(bookings.affiliateId);

    // Days, with the empty ones filled in so the chart has a stable x axis.
    const dayMap = new Map(byDay.map((d) => [d.date, d]));
    const daily = Array.from({ length: daysInMonth }, (_, i) => {
      const date = first.plus({ days: i }).toFormat('yyyy-MM-dd');
      const row = dayMap.get(date);
      return {
        date,
        bookings: row?.bookings ?? 0,
        revenueMinor: row?.revenueMinor ?? 0,
        affiliateRevenueMinor: row?.affiliateRevenueMinor ?? 0,
      };
    });
    const sum = (pick: (row: (typeof byDay)[number]) => number) =>
      byDay.reduce((total, row) => total + pick(row), 0);

    const channels = CHANNELS.map((channel) => {
      const row = byChannel.find((c) => c.channel === channel);
      return { channel, bookings: row?.bookings ?? 0, revenueMinor: row?.revenueMinor ?? 0 };
    });

    const entry = (affiliateId: string | null, status: 'pending' | 'approved' | 'paid') =>
      entryRows
        .filter(
          (e) => e.status === status && (affiliateId === null || e.affiliateId === affiliateId),
        )
        .reduce((total, e) => total + e.total, 0);

    // Plans resolved in memory, like CommissionsService.planFor but for the whole network.
    const defaultPlan = planRows.find((p) => p.isDefault && p.archivedAt === null);
    const planOf = (a: (typeof affiliateRows)[number]) => {
      const row = a.commissionPlanId
        ? planRows.find((p) => p.id === a.commissionPlanId)
        : defaultPlan;
      if (!row && a.commissionRateBpsOverride === null) return null;
      return effectivePlan(row ? planFromRow(row) : NO_PLAN, a.commissionRateBpsOverride);
    };

    const network = affiliateRows
      .map((a) => {
        const sold = sales.find((s) => s.affiliateId === a.id);
        const plan = planOf(a);
        const paidSales = sold?.paidSales ?? 0;
        return {
          affiliateId: a.id,
          name: a.displayName,
          status: a.status,
          paidSales,
          salesMinor: sold?.salesMinor ?? 0,
          clicks: clickRows.find((c) => c.affiliateId === a.id)?.count ?? 0,
          commissionMinor: entry(a.id, 'pending') + entry(a.id, 'approved') + entry(a.id, 'paid'),
          payableMinor: payableRows.find((p) => p.affiliateId === a.id)?.total ?? 0,
          progress: tierProgress(plan ?? NO_PLAN, paidSales),
          planKind: plan?.kind ?? null,
        };
      })
      .filter((a) => a.status !== 'invited' || a.paidSales > 0 || a.commissionMinor !== 0)
      .sort(
        (x, y) =>
          y.paidSales - x.paidSales || y.salesMinor - x.salesMinor || x.name.localeCompare(y.name),
      );

    const pendingMinor = entry(null, 'pending');
    const approvedMinor = entry(null, 'approved');
    const paidMinor = entry(null, 'paid');

    return {
      periodKey,
      currency: tenant.currency,
      timezone: tz,
      throughDate: first.plus({ days: throughDay - 1 }).toFormat('yyyy-MM-dd'),
      totals: {
        bookings: sum((r) => r.bookings),
        revenueMinor: sum((r) => r.revenueMinor),
        seats: sum((r) => r.seats),
        affiliateBookings: sum((r) => r.affiliateBookings),
        affiliateRevenueMinor: sum((r) => r.affiliateRevenueMinor),
        clicks: clickRows.reduce((total, c) => total + c.count, 0),
      },
      previous,
      daily,
      channels,
      commissions: {
        pendingMinor,
        approvedMinor,
        paidMinor,
        totalMinor: pendingMinor + approvedMinor + paidMinor,
        payableMinor: payableRows.reduce((total, p) => total + p.total, 0),
      },
      affiliates: network,
    };
  }

  /** The month before, up to the same day of the month (or its last day, if shorter). */
  private async previousMonth(
    tenant: Tenant,
    periodKey: string,
    throughDay: number,
    paidIn: (from: Date, to: Date) => ReturnType<typeof and>,
  ): Promise<OperatorAnalyticsDto['previous']> {
    const key = previousPeriod(periodKey);
    const { start, end } = periodRange(key, tenant.timezone);
    const first = DateTime.fromJSDate(start, { zone: tenant.timezone });
    const day = Math.min(throughDay, first.daysInMonth ?? 31);
    const cut = DateTime.min(first.plus({ days: day }), DateTime.fromJSDate(end)).toJSDate();
    const [row] = await this.db
      .select({
        bookings: sql<number>`count(*)::int`,
        revenueMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .where(paidIn(start, cut));
    return {
      periodKey: key,
      throughDay: day,
      bookings: row?.bookings ?? 0,
      revenueMinor: row?.revenueMinor ?? 0,
    };
  }
}
