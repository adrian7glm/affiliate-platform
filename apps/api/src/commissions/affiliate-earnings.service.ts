import { Inject, Injectable } from '@nestjs/common';
import { periodKeyFor, periodRange, previousPeriod, tierProgress } from '@ap/commission';
import type { AffiliateHomeDto, AffiliateMonthDto, EarningsDto } from '@ap/contracts';
import { type Database, affiliates, bookings, commissionEntries, products } from '@ap/db';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { BookingService } from '../booking/booking.service';
import { Clock } from '../common/clock';
import { NotFound } from '../common/errors';
import { type Tenant, TenantsService } from '../common/tenants';
import { paidBetween } from '../common/sales';
import { DB } from '../database/database.module';
import { LinksService } from '../tracking/links.service';
import { CommissionPlansService } from './commission-plans.service';
import { sumMinor } from '../common/sql';

/** What an affiliate sees: this month's earnings, level progress, history and entries. */
@Injectable()
export class AffiliateEarningsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly links: LinksService,
    private readonly bookingService: BookingService,
    private readonly plans: CommissionPlansService,
  ) {}

  private async paidSalesCount(
    affiliateId: string,
    tenant: Tenant,
    periodKey: string,
  ): Promise<number> {
    const { start, end } = periodRange(periodKey, tenant.timezone);
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.affiliateId, affiliateId), paidBetween(start, end)));
    return row?.count ?? 0;
  }

  async home(tenantId: string, affiliateId: string): Promise<AffiliateHomeDto> {
    const tenant = await this.tenants.get(tenantId);
    const [affiliate] = await this.db
      .select()
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId));
    if (!affiliate) throw new NotFound('affiliate');
    const periodKey = periodKeyFor(this.clock.now(), tenant.timezone);
    const resolved = await this.plans.planFor(this.db, affiliateId);
    const plan = resolved?.plan ?? { kind: 'fixed' as const, rateBps: 0, basis: 'gross' as const };
    const paidSales = await this.paidSalesCount(affiliateId, tenant, periodKey);

    const sums = await this.db
      .select({
        status: commissionEntries.status,
        total: sumMinor(commissionEntries.amountMinor),
      })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.affiliateId, affiliateId),
          eq(commissionEntries.periodKey, periodKey),
        ),
      )
      .groupBy(commissionEntries.status);
    const sum = (status: string) => sums.find((s) => s.status === status)?.total ?? 0;
    const [payable] = await this.db
      .select({ total: sumMinor(commissionEntries.amountMinor) })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.affiliateId, affiliateId),
          eq(commissionEntries.status, 'approved'),
        ),
      );

    const linkId = await this.links.primaryLinkId(this.db, tenantId, affiliateId);
    const [primaryLink] = await this.links.list(affiliateId, [linkId]);

    return {
      affiliate: { id: affiliate.id, displayName: affiliate.displayName, status: affiliate.status },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        currency: tenant.currency,
        timezone: tenant.timezone,
        allowPayOnSite: tenant.allowPayOnSite,
        branding: tenant.branding ?? {},
      },
      periodKey,
      earnings: {
        pendingMinor: sum('pending'),
        approvedMinor: sum('approved') + sum('paid'),
        monthTotalMinor: sum('pending') + sum('approved') + sum('paid'),
        payableMinor: payable?.total ?? 0,
      },
      progress: tierProgress(plan, paidSales),
      plan: {
        kind: plan.kind,
        mode: plan.kind === 'tiered' ? plan.mode : null,
        tiers: plan.kind === 'tiered' ? plan.tiers : [{ fromSale: 1, rateBps: plan.rateBps }],
      },
      primaryLink: primaryLink!,
      recentBookings: await this.bookingService.listForAffiliate(affiliateId, 10),
      history: await this.monthlyHistory(affiliateId, tenant, periodKey, 6),
    };
  }

  /** Sales and commission per month for the last `months` periods, oldest first. */
  private async monthlyHistory(
    affiliateId: string,
    tenant: Tenant,
    currentKey: string,
    months: number,
  ): Promise<AffiliateMonthDto[]> {
    const keys = [currentKey];
    while (keys.length < months) keys.unshift(previousPeriod(keys[0]!));
    const start = periodRange(keys[0]!, tenant.timezone).start;
    const end = periodRange(currentKey, tenant.timezone).end;
    const monthOfPayment = sql<string>`to_char(${bookings.paidAt} at time zone ${tenant.timezone}, 'YYYY-MM')`;
    const sales = await this.db
      .select({
        periodKey: monthOfPayment,
        count: sql<number>`count(*)::int`,
        total: sumMinor(bookings.totalMinor),
      })
      .from(bookings)
      .where(and(eq(bookings.affiliateId, affiliateId), paidBetween(start, end)))
      // By position: the timezone is a bind parameter, so Postgres would not match the
      // repeated expression.
      .groupBy(sql`1`);
    const commission = await this.db
      .select({
        periodKey: commissionEntries.periodKey,
        total: sumMinor(commissionEntries.amountMinor),
      })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.affiliateId, affiliateId),
          inArray(commissionEntries.periodKey, keys),
        ),
      )
      .groupBy(commissionEntries.periodKey);
    return keys.map((key) => {
      const s = sales.find((r) => r.periodKey === key);
      return {
        periodKey: key,
        paidSales: s?.count ?? 0,
        salesMinor: s?.total ?? 0,
        commissionMinor: commission.find((r) => r.periodKey === key)?.total ?? 0,
      };
    });
  }

  async earnings(tenantId: string, affiliateId: string, periodKey: string): Promise<EarningsDto> {
    const tenant = await this.tenants.get(tenantId);
    const rows = await this.db
      .select({
        entry: commissionEntries,
        reference: bookings.reference,
        productName: products.name,
      })
      .from(commissionEntries)
      .innerJoin(bookings, eq(bookings.id, commissionEntries.bookingId))
      .innerJoin(products, eq(products.id, bookings.productId))
      .where(
        and(
          eq(commissionEntries.affiliateId, affiliateId),
          eq(commissionEntries.periodKey, periodKey),
        ),
      )
      .orderBy(desc(commissionEntries.createdAt));
    return {
      periodKey,
      currency: tenant.currency,
      totalMinor: rows.reduce((sum, r) => sum + r.entry.amountMinor, 0),
      entries: rows.map(({ entry, reference, productName }) => ({
        id: entry.id,
        bookingReference: reference,
        productName,
        kind: entry.kind,
        status: entry.status,
        amountMinor: entry.amountMinor,
        rateBps: entry.rateBps,
        baseMinor: entry.baseMinor,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
