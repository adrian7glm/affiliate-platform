import { Inject, Injectable } from '@nestjs/common';
import { periodKeyFor, periodRange, previousPeriod } from '@ap/commission';
import type {
  AdminOverviewDto,
  AdminTenantDetailDto,
  AdminTenantRowDto,
  SubscriptionDto,
  UpdateTenantStatusBody,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  auditLog,
  bookings,
  memberships,
  products,
  tenants,
  users,
} from '@ap/db';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { NotFound } from '../common/errors';
import { col } from '../common/sql';
import { DB } from '../database/database.module';
import { OnboardingService } from './onboarding.service';
import { SubscriptionsService } from './subscriptions.service';

/** Admin reports use the platform owner's calendar month. */
export const PLATFORM_TIMEZONE = 'Europe/Bucharest';

/**
 * A booking counts for platform revenue once it is confirmed (paid online or booked to pay at
 * boarding), in the month it was paid, or created when paid on site. Cancelled and refunded
 * bookings drop out.
 */
const countedAt = sql`coalesce(${bookings.paidAt}, ${bookings.createdAt})`;
const counted = eq(bookings.status, 'confirmed');

type TenantRow = typeof tenants.$inferSelect;

/** The platform owner's view across every operator. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly subscriptions: SubscriptionsService,
    private readonly onboarding: OnboardingService,
  ) {}

  currentPeriod(): string {
    return periodKeyFor(this.clock.now(), PLATFORM_TIMEZONE);
  }

  private async rows(period: string, tenantId?: string): Promise<AdminTenantRowDto[]> {
    const { start, end } = periodRange(period, PLATFORM_TIMEZONE);
    const inPeriod = and(counted, gte(countedAt, start), lt(countedAt, end));
    const list = await this.db
      .select({
        tenant: tenants,
        ownerEmail: sql<string | null>`(select ${col(users.email)} from ${memberships}
          join ${users} on ${col(users.id)} = ${col(memberships.userId)}
          where ${col(memberships.tenantId)} = ${col(tenants.id)}
            and ${col(memberships.role)} = 'owner'
          order by ${col(memberships.createdAt)} limit 1)`,
        affiliates: sql<number>`(select count(*)::int from ${affiliates}
          where ${col(affiliates.tenantId)} = ${col(tenants.id)}
            and ${col(affiliates.status)} <> 'suspended')`,
        lastBookingAt: sql<Date | null>`(select max(${col(bookings.createdAt)}) from ${bookings}
          where ${col(bookings.tenantId)} = ${col(tenants.id)})`,
      })
      .from(tenants)
      .where(tenantId ? eq(tenants.id, tenantId) : undefined)
      .orderBy(asc(tenants.name));

    const volume = await this.db
      .select({
        tenantId: bookings.tenantId,
        bookings: sql<number>`count(*)::int`,
        grossMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
        feesMinor: sql<number>`coalesce(sum(${bookings.platformFeeMinor}), 0)::int`,
      })
      .from(bookings)
      .where(tenantId ? and(inPeriod, eq(bookings.tenantId, tenantId)) : inPeriod)
      .groupBy(bookings.tenantId);
    const byTenant = new Map(volume.map((v) => [v.tenantId, v]));
    const subs = await this.subscriptions.all();

    return list.map(({ tenant, ownerEmail, affiliates: affiliateCount, lastBookingAt }) => {
      const v = byTenant.get(tenant.id);
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        currency: tenant.currency,
        createdAt: tenant.createdAt.toISOString(),
        ownerEmail,
        subscription: subs.get(tenant.id) ?? null,
        affiliates: affiliateCount,
        bookings: v?.bookings ?? 0,
        grossMinor: v?.grossMinor ?? 0,
        platformFeesMinor: v?.feesMinor ?? 0,
        lastBookingAt: lastBookingAt ? new Date(lastBookingAt).toISOString() : null,
      };
    });
  }

  async overview(period = this.currentPeriod()): Promise<AdminOverviewDto> {
    const rows = await this.rows(period);
    const { start, end } = periodRange(period, PLATFORM_TIMEZONE);

    const isPaying = (s: SubscriptionDto | null) => s?.status === 'active';
    const mrr = new Map<string, number>();
    const volume = new Map<string, AdminOverviewDto['volume'][number]>();
    for (const row of rows) {
      if (row.status === 'active' && isPaying(row.subscription)) {
        const s = row.subscription!;
        mrr.set(s.currency, (mrr.get(s.currency) ?? 0) + s.monthlyPriceMinor);
      }
      if (row.bookings > 0) {
        const v = volume.get(row.currency) ?? {
          currency: row.currency,
          bookings: 0,
          grossMinor: 0,
          platformFeesMinor: 0,
        };
        v.bookings += row.bookings;
        v.grossMinor += row.grossMinor;
        v.platformFeesMinor += row.platformFeesMinor;
        volume.set(row.currency, v);
      }
    }

    const live = rows.filter((r) => r.status === 'active');
    return {
      period,
      operators: {
        total: rows.length,
        active: live.filter((r) => isPaying(r.subscription)).length,
        trialing: live.filter((r) => r.subscription?.status === 'trialing').length,
        suspended: rows.filter((r) => r.status === 'suspended').length,
        pastDue: live.filter((r) => r.subscription?.status === 'past_due').length,
      },
      mrr: [...mrr].map(([currency, amountMinor]) => ({ currency, amountMinor })),
      volume: [...volume.values()],
      newOperators: rows.filter((r) => {
        const created = new Date(r.createdAt);
        return created >= start && created < end;
      }).length,
      tenants: rows,
    };
  }

  async tenant(id: string): Promise<AdminTenantDetailDto> {
    const period = this.currentPeriod();
    const [row] = await this.rows(period, id);
    if (!row) throw new NotFound('operator');
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, id));

    const owners = await this.db
      .select({ userId: users.id, name: users.name, email: users.email, phone: users.phone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, id), eq(memberships.role, 'owner')))
      .orderBy(asc(memberships.createdAt));

    const [productCount] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.tenantId, id));

    return {
      ...row,
      timezone: tenant!.timezone,
      suspendedAt: tenant!.suspendedAt?.toISOString() ?? null,
      suspendedReason: tenant!.suspendedReason,
      stripeAccountConnected: tenant!.stripeAccountId !== null,
      owners,
      products: productCount?.n ?? 0,
      months: await this.months(id, period, 6),
      setup: await this.onboarding.setup(id),
      audit: await this.audit(id),
    };
  }

  private async months(tenantId: string, last: string, count: number) {
    const periods = [last];
    while (periods.length < count) periods.unshift(previousPeriod(periods[0]!));
    const from = periodRange(periods[0]!, PLATFORM_TIMEZONE).start;
    const to = periodRange(last, PLATFORM_TIMEZONE).end;
    const month = sql<string>`to_char(${countedAt} at time zone ${sql.raw(`'${PLATFORM_TIMEZONE}'`)}, 'YYYY-MM')`;
    const rows = await this.db
      .select({
        period: month,
        bookings: sql<number>`count(*)::int`,
        grossMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
        platformFeesMinor: sql<number>`coalesce(sum(${bookings.platformFeeMinor}), 0)::int`,
      })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), counted, gte(countedAt, from), lt(countedAt, to)))
      .groupBy(month);
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    return periods.map((period) => ({
      period,
      bookings: byPeriod.get(period)?.bookings ?? 0,
      grossMinor: byPeriod.get(period)?.grossMinor ?? 0,
      platformFeesMinor: byPeriod.get(period)?.platformFeesMinor ?? 0,
    }));
  }

  private async audit(tenantId: string) {
    const rows = await this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        data: auditLog.data,
        createdAt: auditLog.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(eq(auditLog.tenantId, tenantId))
      .orderBy(desc(auditLog.createdAt))
      .limit(30);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actorName ?? r.actorEmail ?? null,
      data: r.data as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async setStatus(
    id: string,
    body: UpdateTenantStatusBody,
    actorUserId: string,
  ): Promise<AdminTenantDetailDto> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(tenants).where(eq(tenants.id, id));
      if (!current) throw new NotFound('operator');
      const patch: Partial<TenantRow> =
        body.status === 'suspended'
          ? { status: 'suspended', suspendedAt: this.clock.now(), suspendedReason: body.reason }
          : { status: 'active', suspendedAt: null, suspendedReason: null };
      await tx.update(tenants).set(patch).where(eq(tenants.id, id));
      await this.subscriptions.audit(
        tx,
        id,
        actorUserId,
        body.status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
        'tenant',
        id,
        body.status === 'suspended' ? { reason: body.reason } : {},
      );
    });
    return this.tenant(id);
  }
}
