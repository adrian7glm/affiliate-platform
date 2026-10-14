import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type CommissionPlan, effectivePlan, validatePlan } from '@ap/commission';
import type { ArchivePlanResultDto, CommissionPlanDto, CreatePlanBody } from '@ap/contracts';
import { type Database, affiliates, commissionPlans } from '@ap/db';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { DB, type DbOrTx } from '../database/database.module';

type PlanRow = typeof commissionPlans.$inferSelect;

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

/** Commission plans (fixed or progressive) and which plan applies to an affiliate. */
@Injectable()
export class CommissionPlansService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

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
  ): Promise<{ plan: CommissionPlan; source: string; negotiated: boolean } | null> {
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
    const negotiated = affiliate.commissionRateBpsOverride !== null;
    return {
      plan: effectivePlan(base, affiliate.commissionRateBpsOverride),
      source: negotiated ? 'negotiated rate' : (row?.name ?? 'plan'),
      negotiated,
    };
  }
}
