import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { periodKeyFor, periodRange } from '@ap/commission';
import type {
  BillingRedirectDto,
  CreatePlatformPlanBody,
  OperatorBillingDto,
  PlatformPlanDto,
  SignupOptionsDto,
  SubscriptionDto,
  SubscriptionStatus,
  UpdatePlatformPlanBody,
  UpdateTenantBillingBody,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  auditLog,
  bookings,
  memberships,
  platformPlans,
  tenantSubscriptions,
  tenants,
  users,
} from '@ap/db';
import { and, asc, eq, gte, lt, ne, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { col } from '../common/sql';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { BillingGateway } from './billing.gateway';

type PlanRow = typeof platformPlans.$inferSelect;
type SubscriptionRow = typeof tenantSubscriptions.$inferSelect;

const DAY_MS = 86_400_000;

export interface StartSubscriptionOptions {
  planId?: string | null;
  feeBpsOverride?: number | null;
  trialDays?: number | null;
}

/** Stripe subscription statuses, folded into ours. */
export function fromStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      // past_due, unpaid, incomplete, paused: the operator owes money.
      return 'past_due';
  }
}

/**
 * The platform's own revenue: plans (monthly price + fee per booking) and each operator's
 * subscription. The fee actually charged on bookings is copied to `tenants.platform_fee_bps`,
 * so the booking path never has to know about plans.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger('Subscriptions');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly billing: BillingGateway,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------------------------

  private planDto(row: PlanRow, tenantCount = 0): PlatformPlanDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      monthlyPriceMinor: row.monthlyPriceMinor,
      currency: row.currency,
      platformFeeBps: row.platformFeeBps,
      trialDays: row.trialDays,
      maxAffiliates: row.maxAffiliates,
      stripePriceId: row.stripePriceId,
      isDefault: row.isDefault,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      tenantCount,
    };
  }

  async listPlans(): Promise<PlatformPlanDto[]> {
    const rows = await this.db
      .select({
        plan: platformPlans,
        tenantCount: sql<number>`(select count(*)::int from ${tenantSubscriptions}
          where ${tenantSubscriptions.planId} = ${col(platformPlans.id)}
            and ${tenantSubscriptions.status} <> 'canceled')`,
      })
      .from(platformPlans)
      .orderBy(asc(platformPlans.sortOrder), asc(platformPlans.monthlyPriceMinor));
    return rows.map((r) => this.planDto(r.plan, r.tenantCount));
  }

  /** The plans an operator can choose from when signing up or subscribing. */
  async publicPlans(): Promise<SignupOptionsDto['plans']> {
    const plans = await this.listPlans();
    return plans
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        monthlyPriceMinor: p.monthlyPriceMinor,
        currency: p.currency,
        platformFeeBps: p.platformFeeBps,
        trialDays: p.trialDays,
        maxAffiliates: p.maxAffiliates,
        isDefault: p.isDefault,
      }));
  }

  async plan(id: string, db: DbOrTx = this.db): Promise<PlanRow> {
    const [row] = await db.select().from(platformPlans).where(eq(platformPlans.id, id));
    if (!row) throw new NotFound('plan');
    return row;
  }

  async defaultPlan(db: DbOrTx = this.db): Promise<PlanRow> {
    const [row] = await db
      .select()
      .from(platformPlans)
      .where(and(eq(platformPlans.isActive, true)))
      .orderBy(sql`${platformPlans.isDefault} desc`, asc(platformPlans.sortOrder))
      .limit(1);
    if (!row) throw new DomainError('errors.platform.noDefaultPlan');
    return row;
  }

  async createPlan(body: CreatePlatformPlanBody, actorUserId: string): Promise<PlatformPlanDto> {
    const plan = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: platformPlans.id })
        .from(platformPlans)
        .where(eq(platformPlans.code, body.code));
      if (existing) {
        throw new DomainError('errors.platform.planCodeTaken', HttpStatus.CONFLICT, undefined, {
          code: body.code,
        });
      }
      if (body.isDefault) await tx.update(platformPlans).set({ isDefault: false });
      const [created] = await tx.insert(platformPlans).values(body).returning();
      await this.audit(tx, null, actorUserId, 'plan.created', 'plan', created!.id, body);
      return created!;
    });
    return this.planDto(plan);
  }

  async updatePlan(
    id: string,
    body: UpdatePlatformPlanBody,
    actorUserId: string,
  ): Promise<PlatformPlanDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.plan(id, tx);
      if (body.isActive === false && (body.isDefault ?? current.isDefault)) {
        throw new DomainError('errors.platform.defaultPlanRetire');
      }
      if (body.isDefault) {
        await tx.update(platformPlans).set({ isDefault: false }).where(ne(platformPlans.id, id));
      }
      await tx.update(platformPlans).set(body).where(eq(platformPlans.id, id));
      if (body.platformFeeBps !== undefined && body.platformFeeBps !== current.platformFeeBps) {
        // Operators on this plan without a negotiated fee pay the new fee on their next booking.
        await tx
          .update(tenants)
          .set({ platformFeeBps: body.platformFeeBps })
          .where(
            sql`${tenants.id} in (select ${tenantSubscriptions.tenantId} from ${tenantSubscriptions}
              where ${tenantSubscriptions.planId} = ${id}
                and ${tenantSubscriptions.feeBpsOverride} is null)`,
          );
      }
      await this.audit(tx, null, actorUserId, 'plan.updated', 'plan', id, body);
    });
    const plans = await this.listPlans();
    return plans.find((p) => p.id === id)!;
  }

  // -------------------------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------------------------

  /** Subscribes a brand-new operator to a plan, starting with the plan's free trial. */
  async start(tx: DbOrTx, tenantId: string, options: StartSubscriptionOptions = {}) {
    const plan = options.planId ? await this.plan(options.planId, tx) : await this.defaultPlan(tx);
    if (!plan.isActive) throw new DomainError('errors.platform.planRetired');
    const now = this.clock.now();
    const trialDays = options.trialDays ?? plan.trialDays;
    await tx.insert(tenantSubscriptions).values({
      tenantId,
      planId: plan.id,
      status: trialDays > 0 ? 'trialing' : 'active',
      trialEndsAt: trialDays > 0 ? new Date(now.getTime() + trialDays * DAY_MS) : null,
      feeBpsOverride: options.feeBpsOverride ?? null,
    });
    await this.syncFee(tx, tenantId);
  }

  async row(tenantId: string, db: DbOrTx = this.db): Promise<SubscriptionRow | null> {
    const [row] = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantId));
    return row ?? null;
  }

  /** Copies the fee in force (negotiated or the plan's) onto the operator for new bookings. */
  async syncFee(tx: DbOrTx, tenantId: string): Promise<void> {
    const [row] = await tx
      .select({
        override: tenantSubscriptions.feeBpsOverride,
        planFee: platformPlans.platformFeeBps,
      })
      .from(tenantSubscriptions)
      .innerJoin(platformPlans, eq(platformPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenantId));
    if (!row) return;
    await tx
      .update(tenants)
      .set({ platformFeeBps: row.override ?? row.planFee })
      .where(eq(tenants.id, tenantId));
  }

  /**
   * A trial that ended without a paid subscription is reported as past due. Nothing is switched
   * off automatically: suspending an operator is always the platform owner's decision.
   */
  effectiveStatus(row: Pick<SubscriptionRow, 'status' | 'trialEndsAt'>): SubscriptionStatus {
    if (row.status === 'trialing' && row.trialEndsAt && row.trialEndsAt <= this.clock.now()) {
      return 'past_due';
    }
    return row.status;
  }

  toDto(row: SubscriptionRow, plan: PlanRow): SubscriptionDto {
    return {
      planId: plan.id,
      planName: plan.name,
      status: this.effectiveStatus(row),
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      monthlyPriceMinor: row.priceMinorOverride ?? plan.monthlyPriceMinor,
      currency: plan.currency,
      platformFeeBps: row.feeBpsOverride ?? plan.platformFeeBps,
      feeBpsOverride: row.feeBpsOverride,
      priceMinorOverride: row.priceMinorOverride,
      maxAffiliates: plan.maxAffiliates,
      billedByStripe: row.stripeSubscriptionId !== null,
    };
  }

  /** Every operator's subscription, keyed by tenant id (for admin lists). */
  async all(): Promise<Map<string, SubscriptionDto>> {
    const rows = await this.db
      .select({ sub: tenantSubscriptions, plan: platformPlans })
      .from(tenantSubscriptions)
      .innerJoin(platformPlans, eq(platformPlans.id, tenantSubscriptions.planId));
    return new Map(rows.map((r) => [r.sub.tenantId, this.toDto(r.sub, r.plan)]));
  }

  async forTenant(tenantId: string): Promise<SubscriptionDto | null> {
    const [row] = await this.db
      .select({ sub: tenantSubscriptions, plan: platformPlans })
      .from(tenantSubscriptions)
      .innerJoin(platformPlans, eq(platformPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenantId));
    return row ? this.toDto(row.sub, row.plan) : null;
  }

  /** Platform fees on the operator's confirmed bookings this month (their calendar). */
  async feesThisMonth(tenantId: string): Promise<OperatorBillingDto['feesThisMonth']> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new NotFound('operator');
    const { start, end } = periodRange(
      periodKeyFor(this.clock.now(), tenant.timezone),
      tenant.timezone,
    );
    const at = sql`coalesce(${bookings.paidAt}, ${bookings.createdAt})`;
    const [row] = await this.db
      .select({
        amountMinor: sql<number>`coalesce(sum(${bookings.platformFeeMinor}), 0)::int`,
        bookings: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.status, 'confirmed'),
          gte(at, start),
          lt(at, end),
        ),
      );
    return {
      amountMinor: row?.amountMinor ?? 0,
      bookings: row?.bookings ?? 0,
      currency: tenant.currency,
    };
  }

  /** Plan limits: refuses a new affiliate once the plan's maximum is reached. */
  async assertCanAddAffiliate(tenantId: string, db: DbOrTx = this.db): Promise<void> {
    const [row] = await db
      .select({ max: platformPlans.maxAffiliates, plan: platformPlans.name })
      .from(tenantSubscriptions)
      .innerJoin(platformPlans, eq(platformPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, tenantId));
    if (!row || row.max === null) return;
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(affiliates)
      .where(and(eq(affiliates.tenantId, tenantId), ne(affiliates.status, 'suspended')));
    if ((count?.n ?? 0) >= row.max) {
      throw new DomainError(
        'errors.platform.affiliateLimit',
        HttpStatus.PAYMENT_REQUIRED,
        { limit: row.max },
        { plan: row.plan, count: row.max },
      );
    }
  }

  /** Platform owner changes an operator's plan, negotiated prices, trial or payment state. */
  async adminUpdate(
    tenantId: string,
    body: UpdateTenantBillingBody,
    actorUserId: string,
  ): Promise<SubscriptionDto> {
    const current = await this.row(tenantId);
    const stripeManaged = current?.stripeSubscriptionId != null;
    if (stripeManaged && (body.paidUntil || body.cancel)) {
      throw new DomainError('errors.platform.stripeManaged');
    }

    const plan = body.planId ? await this.plan(body.planId) : null;
    if (plan && !plan.isActive) throw new DomainError('errors.platform.planRetired');
    if (plan && stripeManaged) {
      if (!plan.stripePriceId) {
        throw new DomainError('errors.platform.noStripePrice');
      }
      await this.billing.changePrice(current!.stripeSubscriptionId!, plan.stripePriceId);
    }

    await this.db.transaction(async (tx) => {
      if (!current) {
        await this.start(tx, tenantId, { planId: body.planId });
      }
      const now = this.clock.now();
      const patch: Partial<typeof tenantSubscriptions.$inferInsert> = { updatedAt: now };
      if (body.planId) patch.planId = body.planId;
      if (body.feeBpsOverride !== undefined) patch.feeBpsOverride = body.feeBpsOverride;
      if (body.priceMinorOverride !== undefined) patch.priceMinorOverride = body.priceMinorOverride;
      if (body.trialEndsAt) {
        const status = current ? current.status : 'trialing';
        if (status !== 'trialing') throw new DomainError('errors.platform.onlyTrialExtend');
        patch.trialEndsAt = new Date(body.trialEndsAt);
      }
      if (body.paidUntil) {
        patch.status = 'active';
        patch.currentPeriodEnd = new Date(body.paidUntil);
        patch.canceledAt = null;
      }
      if (body.cancel) {
        patch.status = 'canceled';
        patch.canceledAt = now;
      }
      await tx
        .update(tenantSubscriptions)
        .set(patch)
        .where(eq(tenantSubscriptions.tenantId, tenantId));
      await this.syncFee(tx, tenantId);
      await this.audit(tx, tenantId, actorUserId, 'subscription.updated', 'tenant', tenantId, body);
    });
    return (await this.forTenant(tenantId))!;
  }

  // -------------------------------------------------------------------------------------------
  // Operator self-service billing
  // -------------------------------------------------------------------------------------------

  /**
   * Starts paying: Stripe Checkout when Stripe Billing is on; with manual billing the operator
   * just picks the plan and the platform owner invoices them.
   */
  async checkout(tenantId: string, userId: string, planId?: string): Promise<BillingRedirectDto> {
    const returnUrl = `${this.config.WEB_URL}/o/billing`;
    let current = await this.row(tenantId);
    if (!current) {
      await this.db.transaction((tx) => this.start(tx, tenantId, { planId }));
      current = (await this.row(tenantId))!;
    }
    const plan = await this.plan(planId ?? current.planId);
    if (!plan.isActive) throw new DomainError('errors.platform.planRetired');

    if (this.billing.name === 'manual') {
      if (plan.id !== current.planId) {
        await this.db.transaction(async (tx) => {
          await tx
            .update(tenantSubscriptions)
            .set({ planId: plan.id, updatedAt: this.clock.now() })
            .where(eq(tenantSubscriptions.tenantId, tenantId));
          await this.syncFee(tx, tenantId);
          await this.audit(tx, tenantId, userId, 'subscription.plan_chosen', 'tenant', tenantId, {
            planId: plan.id,
          });
        });
      }
      return { url: `${returnUrl}?chosen=1` };
    }

    if (current.stripeSubscriptionId) {
      // Already paying through Stripe: plan changes and card updates happen in the portal.
      return this.portal(tenantId);
    }
    if (!plan.stripePriceId) {
      throw new DomainError('errors.platform.noCardPayment');
    }
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
    const [owner] = await this.db
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner')))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    const now = this.clock.now();
    const trialLeft =
      current.status === 'trialing' && current.trialEndsAt && current.trialEndsAt > now
        ? Math.ceil((current.trialEndsAt.getTime() - now.getTime()) / DAY_MS)
        : 0;
    const session = await this.billing.createCheckout({
      tenantId,
      tenantName: tenant!.name,
      email: owner?.email ?? null,
      stripeCustomerId: current.stripeCustomerId,
      stripePriceId: plan.stripePriceId,
      trialDays: trialLeft,
      successUrl: `${returnUrl}?subscribed=1`,
      cancelUrl: returnUrl,
    });
    await this.db
      .update(tenantSubscriptions)
      .set({ stripeCustomerId: session.customerId, updatedAt: now })
      .where(eq(tenantSubscriptions.tenantId, tenantId));
    return { url: session.url };
  }

  async portal(tenantId: string): Promise<BillingRedirectDto> {
    const current = await this.row(tenantId);
    if (this.billing.name !== 'stripe' || !current?.stripeCustomerId) {
      throw new DomainError('errors.platform.noCardSubscription', HttpStatus.CONFLICT);
    }
    return this.billing.createPortal(current.stripeCustomerId, `${this.config.WEB_URL}/o/billing`);
  }

  /** Applies a Stripe subscription object (from a webhook) to the operator it belongs to. */
  async applyStripeSubscription(input: {
    tenantId: string | null;
    customerId: string;
    subscriptionId: string;
    status: string;
    priceId: string | null;
    currentPeriodEnd: number | null;
    trialEnd: number | null;
  }): Promise<void> {
    const [row] = await this.db
      .select()
      .from(tenantSubscriptions)
      .where(
        input.tenantId
          ? eq(tenantSubscriptions.tenantId, input.tenantId)
          : eq(tenantSubscriptions.stripeCustomerId, input.customerId),
      );
    if (!row) {
      this.logger.warn(`Stripe subscription ${input.subscriptionId} matches no operator`);
      return;
    }
    const [plan] = input.priceId
      ? await this.db
          .select({ id: platformPlans.id })
          .from(platformPlans)
          .where(eq(platformPlans.stripePriceId, input.priceId))
      : [];
    const status = fromStripeStatus(input.status);
    await this.db.transaction(async (tx) => {
      await tx
        .update(tenantSubscriptions)
        .set({
          stripeCustomerId: input.customerId,
          stripeSubscriptionId: input.subscriptionId,
          status,
          ...(plan ? { planId: plan.id } : {}),
          currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd * 1000) : null,
          trialEndsAt: input.trialEnd ? new Date(input.trialEnd * 1000) : row.trialEndsAt,
          canceledAt: status === 'canceled' ? this.clock.now() : null,
          updatedAt: this.clock.now(),
        })
        .where(eq(tenantSubscriptions.id, row.id));
      await this.syncFee(tx, row.tenantId);
      await this.audit(tx, row.tenantId, null, 'subscription.stripe_sync', 'tenant', row.tenantId, {
        status: input.status,
        subscriptionId: input.subscriptionId,
      });
    });
  }

  async audit(
    tx: DbOrTx,
    tenantId: string | null,
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    data: object,
  ): Promise<void> {
    await tx.insert(auditLog).values({ tenantId, actorUserId, action, entityType, entityId, data });
  }
}
