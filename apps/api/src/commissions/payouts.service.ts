import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CommissionPlan,
  type Sale,
  buildPayout,
  computePeriodCommissions,
  periodRange,
  reconcile,
} from '@ap/commission';
import type { ClosePeriodResultDto, CommissionReportDto, PayoutDto } from '@ap/contracts';
import { type Database, affiliates, bookings, commissionEntries, payouts } from '@ap/db';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { type Tenant, TenantsService } from '../common/tenants';
import { paidBetween } from '../common/sales';
import { DB } from '../database/database.module';
import { CommissionLedgerService } from './ledger.service';
import { toLedgerEntry } from './ledger-rows';
import { sumMinor } from '../common/sql';

/** The operator's side: monthly report, closing a month and paying affiliates. */
@Injectable()
export class CommissionPayoutsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly ledger: CommissionLedgerService,
  ) {}

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
        total: sumMinor(bookings.totalMinor),
      })
      .from(bookings)
      .where(and(eq(bookings.tenantId, tenantId), paidBetween(start, end)))
      .groupBy(bookings.affiliateId);
    const entries = await this.db
      .select({
        affiliateId: commissionEntries.affiliateId,
        status: commissionEntries.status,
        total: sumMinor(commissionEntries.amountMinor),
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
          await this.ledger.insertEntries(
            tx,
            { ...firstSale, periodKey: saleRow.periodKey },
            [adjustment],
            approved ? 'approved' : 'pending',
          );
        }
        return adjustments.length;
      });
    }

    const entriesApproved = await this.ledger.approveDue(tenantId);
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
      }
      return payout.periodKey;
    });
    const list = await this.listPayouts(tenantId, periodKey);
    return list.find((p) => p.id === payoutId)!;
  }
}
