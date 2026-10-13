import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CommissionPlan,
  type LedgerEntry,
  type NewLedgerEntry,
  type Sale,
  buildPayout,
  commissionAtSale,
  computePeriodCommissions,
  effectivePlan,
  isApprovable,
  periodKeyFor,
  periodRange,
  previousPeriod,
  reconcile,
  reversalFor,
  tierProgress,
  validatePlan,
} from '@ap/commission';
import type {
  AffiliateHomeDto,
  AffiliateMonthDto,
  ClosePeriodResultDto,
  CommissionPlanDto,
  CommissionReportDto,
  ArchivePlanResultDto,
  CreatePlanBody,
  EarningsDto,
  EventOfType,
  PayoutDto,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  commissionEntries,
  commissionPlans,
  payouts,
  products,
  tenants,
  tickets,
} from '@ap/db';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { type Tenant, TenantsService } from '../common/tenants';
import { DB, type DbOrTx, type Tx } from '../database/database.module';
import { Outbox } from '../outbox/outbox';
import { LinksService } from '../tracking/links.service';
import { BookingService } from '../booking/booking.service';

type PlanRow = typeof commissionPlans.$inferSelect;
type EntryRow = typeof commissionEntries.$inferSelect;

export function planFromRow(row: PlanRow): CommissionPlan {
  if (row.kind === 'fixed') return { kind: 'fixed', rateBps: row.rateBps ?? 0, basis: row.basis };
  return { kind: 'tiered', mode: row.mode ?? 'marginal', tiers: row.tiers ?? [], basis: row.basis };
}

export function planDto(row: PlanRow, affiliateCount = 0): CommissionPlanDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    mode: row.mode,
    rateBps: row.rateBps,
    tiers: row.tiers,
    basis: row.basis,
    isDefault: row.isDefault,
    affiliateCount,
  };
}

/** Checks the rules of a create/update request with the commission engine. */
function validatedRules(body: CreatePlanBody): CommissionPlan {
  const plan: CommissionPlan =
    body.kind === 'fixed'
      ? { kind: 'fixed', rateBps: body.rateBps, basis: body.basis }
      : { kind: 'tiered', mode: body.mode, tiers: body.tiers, basis: body.basis };
  if (plan.kind === 'tiered') {
    const tiers = plan.tiers;
    if (tiers.length === 0)
      throw new DomainError('errors.commissionPlan.noTiers', HttpStatus.BAD_REQUEST);
    if (tiers[0]!.fromSale !== 1)
      throw new DomainError('errors.commissionPlan.firstTier', HttpStatus.BAD_REQUEST);
    if (tiers.some((tier, i) => i > 0 && tier.fromSale <= tiers[i - 1]!.fromSale))
      throw new DomainError('errors.commissionPlan.tierOrder', HttpStatus.BAD_REQUEST);
  }
  try {
    validatePlan(plan);
  } catch (error) {
    throw new DomainError('errors.commissionPlan.invalid', HttpStatus.BAD_REQUEST, {
      reason: (error as Error).message,
    });
  }
  return plan;
}

function toLedgerEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    bookingId: row.bookingId,
    kind: row.kind,
    status: row.status,
    amountMinor: row.amountMinor,
    rateBps: row.rateBps,
    baseMinor: row.baseMinor,
  };
}

/** The commission module: plans, the ledger, approvals, reports and payouts. */
@Injectable()
export class CommissionsService implements OnModuleInit {
  private readonly logger = new Logger('Commissions');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly outbox: Outbox,
    private readonly links: LinksService,
    private readonly bookingService: BookingService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('booking.confirmed', 'commissions.record-sale', (event, tx) =>
      this.recordSale(event, tx),
    );
    this.outbox.on('booking.cancelled', 'commissions.reverse', (event, tx) =>
      this.reverse(event, tx),
    );
    this.outbox.on('ticket.checked_in', 'commissions.approve-on-boarding', async (event, tx) => {
      await this.approveBooking(tx, event.bookingId);
    });
  }

  // ----------------------------------------------------------------------------------------------
  // Plans
  // ----------------------------------------------------------------------------------------------

  async listPlans(tenantId: string): Promise<CommissionPlanDto[]> {
    const rows = await this.db
      .select()
      .from(commissionPlans)
      .where(and(eq(commissionPlans.tenantId, tenantId), isNull(commissionPlans.archivedAt)))
      .orderBy(desc(commissionPlans.isDefault), asc(commissionPlans.name));
    const counts = await this.affiliateCounts(this.db, tenantId);
    return rows.map((row) => planDto(row, counts.get(row.id) ?? 0));
  }

  private async affiliateCounts(db: DbOrTx, tenantId: string): Promise<Map<string, number>> {
    const rows = await db
      .select({ planId: affiliates.commissionPlanId, count: sql<number>`count(*)::int` })
      .from(affiliates)
      .where(and(eq(affiliates.tenantId, tenantId), isNotNull(affiliates.commissionPlanId)))
      .groupBy(affiliates.commissionPlanId);
    return new Map(rows.map((r) => [r.planId!, r.count]));
  }

  async createPlan(tenantId: string, body: CreatePlanBody): Promise<CommissionPlanDto> {
    validatedRules(body);
    const row = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: commissionPlans.id })
        .from(commissionPlans)
        .where(and(eq(commissionPlans.tenantId, tenantId), isNull(commissionPlans.archivedAt)))
        .limit(1);
      const makeDefault = body.isDefault || existing.length === 0;
      if (makeDefault) {
        await tx
          .update(commissionPlans)
          .set({ isDefault: false })
          .where(eq(commissionPlans.tenantId, tenantId));
      }
      const [created] = await tx
        .insert(commissionPlans)
        .values({
          tenantId,
          name: body.name,
          kind: body.kind,
          mode: body.kind === 'tiered' ? body.mode : null,
          rateBps: body.kind === 'fixed' ? body.rateBps : null,
          tiers: body.kind === 'tiered' ? body.tiers : null,
          basis: body.basis,
          isDefault: makeDefault,
        })
        .returning();
      return created!;
    });
    return planDto(row);
  }

  /**
   * New rules for a plan. Plans are not edited in place: the old version is archived and a new
   * one takes its name, default flag and affiliates. Commissions already recorded keep the rules
   * they were computed with (the ledger stores a snapshot), and a month is closed with the rules
   * of the affiliate's first sale that month, so the change shows fully from the next month.
   */
  async updatePlan(
    tenantId: string,
    planId: string,
    body: CreatePlanBody,
  ): Promise<CommissionPlanDto> {
    validatedRules(body);
    return this.db.transaction(async (tx) => {
      const old = await this.activePlan(tx, tenantId, planId);
      const makeDefault = old.isDefault || body.isDefault;
      const now = this.clock.now();
      await tx
        .update(commissionPlans)
        .set({ archivedAt: now, isDefault: false })
        .where(eq(commissionPlans.id, old.id));
      if (makeDefault) {
        await tx
          .update(commissionPlans)
          .set({ isDefault: false })
          .where(eq(commissionPlans.tenantId, tenantId));
      }
      const [created] = await tx
        .insert(commissionPlans)
        .values({
          tenantId,
          name: body.name,
          kind: body.kind,
          mode: body.kind === 'tiered' ? body.mode : null,
          rateBps: body.kind === 'fixed' ? body.rateBps : null,
          tiers: body.kind === 'tiered' ? body.tiers : null,
          basis: body.basis,
          isDefault: makeDefault,
        })
        .returning();
      const moved = await tx
        .update(affiliates)
        .set({ commissionPlanId: created!.id })
        .where(and(eq(affiliates.tenantId, tenantId), eq(affiliates.commissionPlanId, old.id)))
        .returning({ id: affiliates.id });
      return planDto(created!, moved.length);
    });
  }

  /** Makes a plan the one used by every affiliate without a plan of their own. */
  async makeDefaultPlan(tenantId: string, planId: string): Promise<CommissionPlanDto> {
    return this.db.transaction(async (tx) => {
      await this.activePlan(tx, tenantId, planId);
      await tx
        .update(commissionPlans)
        .set({ isDefault: false })
        .where(eq(commissionPlans.tenantId, tenantId));
      const [row] = await tx
        .update(commissionPlans)
        .set({ isDefault: true })
        .where(eq(commissionPlans.id, planId))
        .returning();
      const counts = await this.affiliateCounts(tx, tenantId);
      return planDto(row!, counts.get(planId) ?? 0);
    });
  }

  /**
   * Retires a plan. Its affiliates move to the default plan. The default plan itself can't be
   * retired: another plan has to become the default first.
   */
  async archivePlan(tenantId: string, planId: string): Promise<ArchivePlanResultDto> {
    return this.db.transaction(async (tx) => {
      const plan = await this.activePlan(tx, tenantId, planId);
      if (plan.isDefault) {
        throw new DomainError('errors.commissionPlan.isDefault', HttpStatus.CONFLICT);
      }
      const moved = await tx
        .update(affiliates)
        .set({ commissionPlanId: null })
        .where(and(eq(affiliates.tenantId, tenantId), eq(affiliates.commissionPlanId, planId)))
        .returning({ id: affiliates.id });
      await tx
        .update(commissionPlans)
        .set({ archivedAt: this.clock.now() })
        .where(eq(commissionPlans.id, planId));
      return { affiliatesMoved: moved.length };
    });
  }

  private async activePlan(tx: DbOrTx, tenantId: string, planId: string): Promise<PlanRow> {
    const [plan] = await tx
      .select()
      .from(commissionPlans)
      .where(
        and(
          eq(commissionPlans.id, planId),
          eq(commissionPlans.tenantId, tenantId),
          isNull(commissionPlans.archivedAt),
        ),
      )
      .for('update');
    if (!plan) throw new NotFound('commissionPlan');
    return plan;
  }

  async assertPlanBelongs(tenantId: string, planId: string | null | undefined): Promise<void> {
    if (!planId) return;
    const [plan] = await this.db
      .select({ id: commissionPlans.id })
      .from(commissionPlans)
      .where(
        and(
          eq(commissionPlans.id, planId),
          eq(commissionPlans.tenantId, tenantId),
          isNull(commissionPlans.archivedAt),
        ),
      );
    if (!plan) throw new NotFound('commissionPlan');
  }

  /** The rules that apply to an affiliate right now: override, own plan, or the operator default. */
  async planFor(
    db: DbOrTx,
    affiliateId: string,
  ): Promise<{ plan: CommissionPlan; source: string } | null> {
    const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.id, affiliateId));
    if (!affiliate) throw new NotFound('affiliate');
    const [row] = await db
      .select()
      .from(commissionPlans)
      .where(
        and(
          eq(commissionPlans.tenantId, affiliate.tenantId),
          affiliate.commissionPlanId
            ? eq(commissionPlans.id, affiliate.commissionPlanId)
            : and(eq(commissionPlans.isDefault, true), isNull(commissionPlans.archivedAt)),
        ),
      )
      .limit(1);
    if (!row && affiliate.commissionRateBpsOverride === null) return null;
    const base: CommissionPlan = row
      ? planFromRow(row)
      : { kind: 'fixed', rateBps: 0, basis: 'gross' };
    return {
      plan: effectivePlan(base, affiliate.commissionRateBpsOverride),
      source:
        affiliate.commissionRateBpsOverride !== null ? 'negotiated rate' : (row?.name ?? 'plan'),
    };
  }

  // ----------------------------------------------------------------------------------------------
  // Ledger: event handlers
  // ----------------------------------------------------------------------------------------------

  /** booking.confirmed: write the `sale` entry, computed with the sales count at that moment. */
  async recordSale(event: EventOfType<'booking.confirmed'>, tx: Tx): Promise<void> {
    if (!event.affiliateId) return;
    // Serialize sales of one affiliate so two simultaneous payments get sale #4 and #5, not #4 twice.
    await tx
      .select({ id: affiliates.id })
      .from(affiliates)
      .where(eq(affiliates.id, event.affiliateId))
      .for('update');
    const resolved = await this.planFor(tx, event.affiliateId);
    if (!resolved) {
      this.logger.warn(
        `no commission plan for affiliate ${event.affiliateId}; booking ${event.bookingId} earns nothing`,
      );
      return;
    }
    const tenant = await this.tenants.get(event.tenantId, tx);
    const paidAt = new Date(event.paidAt);
    const periodKey = periodKeyFor(paidAt, tenant.timezone);
    const { start } = periodRange(periodKey, tenant.timezone);

    const [before] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.affiliateId, event.affiliateId),
          eq(bookings.status, 'confirmed'),
          gte(bookings.paidAt, start),
          or(
            lt(bookings.paidAt, paidAt),
            and(eq(bookings.paidAt, paidAt), lt(bookings.id, event.bookingId)),
          ),
        ),
      );
    const commission = commissionAtSale(
      resolved.plan,
      { bookingId: event.bookingId, grossMinor: event.totalMinor, taxMinor: event.taxMinor },
      before?.count ?? 0,
    );
    await tx
      .insert(commissionEntries)
      .values({
        tenantId: event.tenantId,
        affiliateId: event.affiliateId,
        bookingId: event.bookingId,
        periodKey,
        kind: 'sale',
        amountMinor: commission.amountMinor,
        rateBps: commission.rateBps,
        baseMinor: commission.baseMinor,
        currency: event.currency,
        reason: `sale #${commission.saleNumber} of ${periodKey} (${resolved.source})`,
        planSnapshot: resolved.plan,
        createdAt: paidAt,
      })
      .onConflictDoNothing();
  }

  /** booking.cancelled: cancel what was earned. Pending entries are approved together with
   *  their reversal so they net out to zero in the next payout. */
  async reverse(event: EventOfType<'booking.cancelled'>, tx: Tx): Promise<void> {
    if (!event.affiliateId) return;
    const rows = await tx
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.bookingId, event.bookingId));
    const reversal = reversalFor(
      rows.map(toLedgerEntry),
      event.bookingId,
      `booking cancelled: ${event.reason}`,
    );
    if (!reversal) return;
    const now = this.clock.now();
    const first = rows[0]!;
    await tx
      .update(commissionEntries)
      .set({ status: 'approved', approvedAt: now })
      .where(
        and(
          eq(commissionEntries.bookingId, event.bookingId),
          eq(commissionEntries.status, 'pending'),
        ),
      );
    await this.insertEntries(tx, first, [reversal], 'approved');
  }

  private async insertEntries(
    tx: DbOrTx,
    template: EntryRow,
    entries: NewLedgerEntry[],
    status: 'pending' | 'approved',
  ): Promise<void> {
    if (entries.length === 0) return;
    const now = this.clock.now();
    await tx.insert(commissionEntries).values(
      entries.map((entry) => ({
        tenantId: template.tenantId,
        affiliateId: template.affiliateId,
        bookingId: entry.bookingId,
        periodKey: template.periodKey,
        kind: entry.kind,
        status: entry.amountMinor < 0 ? ('approved' as const) : status,
        approvedAt: entry.amountMinor < 0 || status === 'approved' ? now : null,
        amountMinor: entry.amountMinor,
        rateBps: entry.rateBps,
        baseMinor: entry.baseMinor,
        currency: template.currency,
        reason: entry.reason,
        planSnapshot: template.planSnapshot,
        createdAt: now,
      })),
    );
  }

  /** Approves the pending entries of a booking whose trip happened (ticket scanned). */
  async approveBooking(tx: DbOrTx, bookingId: string): Promise<number> {
    const rows = await tx
      .update(commissionEntries)
      .set({ status: 'approved', approvedAt: this.clock.now() })
      .where(
        and(eq(commissionEntries.bookingId, bookingId), eq(commissionEntries.status, 'pending')),
      )
      .returning({ id: commissionEntries.id });
    return rows.length;
  }

  /** Approves pending entries whose departure is far enough in the past (scheduled job). */
  async approveDue(tenantId?: string): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .select({
        entry: commissionEntries,
        bookingStatus: bookings.status,
        startsAt: bookings.startsAt,
        checkedInAt: tickets.checkedInAt,
        graceHours: tenants.approvalGraceHours,
      })
      .from(commissionEntries)
      .innerJoin(bookings, eq(bookings.id, commissionEntries.bookingId))
      .innerJoin(tenants, eq(tenants.id, commissionEntries.tenantId))
      .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(
        and(
          eq(commissionEntries.status, 'pending'),
          tenantId ? eq(commissionEntries.tenantId, tenantId) : undefined,
        ),
      )
      .limit(5000);
    const due = rows.filter((row) =>
      isApprovable(
        row.entry,
        {
          cancelled: row.bookingStatus !== 'confirmed',
          startsAt: row.startsAt,
          checkedInAt: row.checkedInAt,
        },
        now,
        row.graceHours,
      ),
    );
    if (due.length === 0) return 0;
    await this.db
      .update(commissionEntries)
      .set({ status: 'approved', approvedAt: now })
      .where(
        and(
          inArray(
            commissionEntries.id,
            due.map((r) => r.entry.id),
          ),
          eq(commissionEntries.status, 'pending'),
        ),
      );
    return due.length;
  }

  // ----------------------------------------------------------------------------------------------
  // Affiliate views
  // ----------------------------------------------------------------------------------------------

  /** Paid, non-cancelled sales of an affiliate in a month: what the tiers count. */
  async paidSalesCount(
    affiliateId: string,
    tenant: Pick<Tenant, 'timezone'>,
    periodKey: string,
    db: DbOrTx = this.db,
  ): Promise<number> {
    const { start, end } = periodRange(periodKey, tenant.timezone);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.affiliateId, affiliateId),
          eq(bookings.status, 'confirmed'),
          gte(bookings.paidAt, start),
          lt(bookings.paidAt, end),
        ),
      );
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
    const resolved = await this.planFor(this.db, affiliateId);
    const plan = resolved?.plan ?? { kind: 'fixed' as const, rateBps: 0, basis: 'gross' as const };
    const paidSales = await this.paidSalesCount(affiliateId, tenant, periodKey);

    const sums = await this.db
      .select({
        status: commissionEntries.status,
        total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int`,
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
      .select({ total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int` })
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
      affiliate: {
        id: affiliate.id,
        displayName: affiliate.displayName,
        status: affiliate.status,
        notifySales: affiliate.notifySales,
      },
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
        total: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.affiliateId, affiliateId),
          eq(bookings.status, 'confirmed'),
          gte(bookings.paidAt, start),
          lt(bookings.paidAt, end),
        ),
      )
      // By position: the timezone is a bind parameter, so Postgres would not match the
      // repeated expression.
      .groupBy(sql`1`);
    const commission = await this.db
      .select({
        periodKey: commissionEntries.periodKey,
        total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int`,
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

  // ----------------------------------------------------------------------------------------------
  // Operator: report, period close, payouts
  // ----------------------------------------------------------------------------------------------

  async report(tenantId: string, periodKey: string): Promise<CommissionReportDto> {
    const tenant = await this.tenants.get(tenantId);
    const { start, end } = periodRange(periodKey, tenant.timezone);
    const affiliateRows = await this.db
      .select({ id: affiliates.id, name: affiliates.displayName })
      .from(affiliates)
      .where(eq(affiliates.tenantId, tenantId))
      .orderBy(asc(affiliates.displayName));
    const sales = await this.db
      .select({
        affiliateId: bookings.affiliateId,
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, 'confirmed'),
          gte(bookings.paidAt, start),
          lt(bookings.paidAt, end),
        ),
      )
      .groupBy(bookings.affiliateId);
    const entries = await this.db
      .select({
        affiliateId: commissionEntries.affiliateId,
        status: commissionEntries.status,
        total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int`,
      })
      .from(commissionEntries)
      .where(
        and(eq(commissionEntries.tenantId, tenantId), eq(commissionEntries.periodKey, periodKey)),
      )
      .groupBy(commissionEntries.affiliateId, commissionEntries.status);

    const rows = affiliateRows
      .map((affiliate) => {
        const s = sales.find((r) => r.affiliateId === affiliate.id);
        const amount = (status: string) =>
          entries.find((e) => e.affiliateId === affiliate.id && e.status === status)?.total ?? 0;
        const pendingMinor = amount('pending');
        const approvedMinor = amount('approved');
        const paidMinor = amount('paid');
        return {
          affiliateId: affiliate.id,
          affiliateName: affiliate.name,
          paidSales: s?.count ?? 0,
          salesMinor: s?.total ?? 0,
          pendingMinor,
          approvedMinor,
          paidMinor,
          totalMinor: pendingMinor + approvedMinor + paidMinor,
        };
      })
      .filter((row) => row.paidSales > 0 || row.totalMinor !== 0);
    const totals = rows.reduce(
      (acc, r) => ({
        paidSales: acc.paidSales + r.paidSales,
        salesMinor: acc.salesMinor + r.salesMinor,
        pendingMinor: acc.pendingMinor + r.pendingMinor,
        approvedMinor: acc.approvedMinor + r.approvedMinor,
        paidMinor: acc.paidMinor + r.paidMinor,
        totalMinor: acc.totalMinor + r.totalMinor,
      }),
      {
        paidSales: 0,
        salesMinor: 0,
        pendingMinor: 0,
        approvedMinor: 0,
        paidMinor: 0,
        totalMinor: 0,
      },
    );
    return { periodKey, currency: tenant.currency, rows, totals };
  }

  /**
   * Month end: reconciles every affiliate's month (retroactive uplifts, re-tiering after
   * cancellations), approves what is due and creates one payout per affiliate. Idempotent.
   */
  async closePeriod(tenantId: string, periodKey: string): Promise<ClosePeriodResultDto> {
    const tenant = await this.tenants.get(tenantId);
    const { start, end } = periodRange(periodKey, tenant.timezone);
    if (this.clock.now() < end)
      throw new DomainError('errors.period.notOver', HttpStatus.CONFLICT, undefined, {
        period: periodKey,
      });

    let adjustmentsCreated = 0;
    const affiliateIds = await this.db
      .selectDistinct({ id: commissionEntries.affiliateId })
      .from(commissionEntries)
      .where(
        and(eq(commissionEntries.tenantId, tenantId), eq(commissionEntries.periodKey, periodKey)),
      );

    for (const { id: affiliateId } of affiliateIds) {
      adjustmentsCreated += await this.db.transaction(async (tx) => {
        await tx
          .select({ id: affiliates.id })
          .from(affiliates)
          .where(eq(affiliates.id, affiliateId))
          .for('update');
        const entryRows = await tx
          .select()
          .from(commissionEntries)
          .where(
            and(
              eq(commissionEntries.affiliateId, affiliateId),
              eq(commissionEntries.periodKey, periodKey),
            ),
          )
          .orderBy(asc(commissionEntries.createdAt));
        const firstSale = entryRows.find((e) => e.kind === 'sale');
        if (!firstSale) return 0;
        const bookingRows = await tx
          .select()
          .from(bookings)
          .where(
            and(
              eq(bookings.affiliateId, affiliateId),
              gte(bookings.paidAt, start),
              lt(bookings.paidAt, end),
            ),
          );
        const sales: Sale[] = bookingRows.map((b) => ({
          bookingId: b.id,
          paidAt: b.paidAt!,
          grossMinor: b.totalMinor,
          taxMinor: b.taxMinor,
          cancelled: b.status !== 'confirmed',
        }));
        // The rules frozen with the month's first sale apply to the whole month.
        const plan = firstSale.planSnapshot as CommissionPlan;
        const expected = computePeriodCommissions(plan, sales).filter((c) =>
          entryRows.some((e) => e.bookingId === c.bookingId),
        );
        const adjustments = reconcile(expected, entryRows.map(toLedgerEntry));
        for (const adjustment of adjustments) {
          const saleRow =
            entryRows.find((e) => e.bookingId === adjustment.bookingId && e.kind === 'sale') ??
            firstSale;
          const approved = saleRow.status !== 'pending';
          await this.insertEntries(
            tx,
            { ...firstSale, periodKey: saleRow.periodKey },
            [adjustment],
            approved ? 'approved' : 'pending',
          );
        }
        return adjustments.length;
      });
    }

    const entriesApproved = await this.approveDue(tenantId);
    const created = await this.createPayouts(tenant, periodKey);
    return { periodKey, adjustmentsCreated, entriesApproved, payouts: created };
  }

  private async createPayouts(tenant: Tenant, periodKey: string): Promise<PayoutDto[]> {
    const affiliateIds = await this.db
      .selectDistinct({ id: commissionEntries.affiliateId })
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.tenantId, tenant.id),
          eq(commissionEntries.status, 'approved'),
          isNull(commissionEntries.payoutId),
        ),
      );
    for (const { id: affiliateId } of affiliateIds) {
      await this.db.transaction(async (tx) => {
        await tx
          .select({ id: affiliates.id })
          .from(affiliates)
          .where(eq(affiliates.id, affiliateId))
          .for('update');
        const rows = await tx
          .select()
          .from(commissionEntries)
          .where(
            and(
              eq(commissionEntries.affiliateId, affiliateId),
              eq(commissionEntries.status, 'approved'),
              isNull(commissionEntries.payoutId),
            ),
          );
        const statement = buildPayout(rows.map(toLedgerEntry));
        if (statement.entryIds.length === 0) return;
        const [payout] = await tx
          .insert(payouts)
          .values({
            tenantId: tenant.id,
            affiliateId,
            periodKey,
            amountMinor: statement.totalMinor,
            currency: tenant.currency,
            status: 'approved',
            method: tenant.payoutMode,
          })
          .onConflictDoNothing()
          .returning({ id: payouts.id });
        if (!payout) return;
        await tx
          .update(commissionEntries)
          .set({ payoutId: payout.id })
          .where(inArray(commissionEntries.id, statement.entryIds));
      });
    }
    return this.listPayouts(tenant.id, periodKey);
  }

  async listPayouts(tenantId: string, periodKey: string): Promise<PayoutDto[]> {
    const rows = await this.db
      .select({ payout: payouts, affiliateName: affiliates.displayName })
      .from(payouts)
      .innerJoin(affiliates, eq(affiliates.id, payouts.affiliateId))
      .where(and(eq(payouts.tenantId, tenantId), eq(payouts.periodKey, periodKey)))
      .orderBy(asc(affiliates.displayName));
    return rows.map(({ payout, affiliateName }) => ({
      id: payout.id,
      affiliateId: payout.affiliateId,
      affiliateName,
      periodKey: payout.periodKey,
      amountMinor: payout.amountMinor,
      currency: payout.currency,
      status: payout.status,
      method: payout.method,
      paidAt: payout.paidAt?.toISOString() ?? null,
    }));
  }

  /** The operator paid the affiliate (bank transfer, cash): close the payout and its entries. */
  async markPaid(tenantId: string, payoutId: string): Promise<PayoutDto> {
    const now = this.clock.now();
    const periodKey = await this.db.transaction(async (tx) => {
      const [payout] = await tx
        .select()
        .from(payouts)
        .where(and(eq(payouts.id, payoutId), eq(payouts.tenantId, tenantId)))
        .for('update');
      if (!payout) throw new NotFound('payout');
      if (payout.status !== 'paid') {
        await tx
          .update(payouts)
          .set({ status: 'paid', paidAt: now })
          .where(eq(payouts.id, payoutId));
        await tx
          .update(commissionEntries)
          .set({ status: 'paid', paidAt: now })
          .where(
            and(eq(commissionEntries.payoutId, payoutId), eq(commissionEntries.status, 'approved')),
          );
        await this.outbox.publish(tx, {
          type: 'payout.paid',
          tenantId,
          payoutId,
          affiliateId: payout.affiliateId,
          periodKey: payout.periodKey,
          amountMinor: payout.amountMinor,
          currency: payout.currency,
        });
      }
      return payout.periodKey;
    });
    const list = await this.listPayouts(tenantId, periodKey);
    return list.find((p) => p.id === payoutId)!;
  }
}
