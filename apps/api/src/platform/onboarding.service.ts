import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CreateOperatorInviteBody,
  type CreateTenantBody,
  type CreateTenantResultDto,
  type OnboardingDto,
  type OnboardingStepKey,
  type OperatorInviteDto,
  type OperatorInvitePreviewDto,
  type OperatorInviteStatus,
  SLUG_PATTERN,
  type SignupOptionsDto,
  type SlugCheckDto,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  availabilitySources,
  bookings,
  commissionPlans,
  memberships,
  operatorInvites,
  platformPlans,
  products,
  slots,
  tenants,
  users,
} from '@ap/db';
import { and, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { IANAZone } from 'luxon';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock';
import { randomToken } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { Notifier } from '../common/notifier';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { SubscriptionsService } from './subscriptions.service';

const INVITE_TTL_MS = 30 * 86_400_000;
/** Self-signup cannot be used to mass-create operators from one account. */
const MAX_OWNED_TENANTS = 5;

type InviteRow = typeof operatorInvites.$inferSelect;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** "Plimbări cu Barca Delta" -> "plimbari-cu-barca-delta" */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `operator-${base || 'nou'}`;
}

/**
 * How operators arrive on the platform: by the platform owner's invitation or by signing up
 * themselves, then a guided setup until they take their first booking.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly notifier: Notifier,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Invitations (platform owner)
  // -------------------------------------------------------------------------------------------

  private inviteStatus(row: InviteRow): OperatorInviteStatus {
    if (row.acceptedAt) return 'accepted';
    if (row.revokedAt) return 'revoked';
    if (row.expiresAt <= this.clock.now()) return 'expired';
    return 'pending';
  }

  private inviteDto(row: InviteRow, planName: string | null, token?: string): OperatorInviteDto {
    return {
      id: row.id,
      email: row.email,
      businessName: row.businessName,
      planName,
      feeBpsOverride: row.feeBpsOverride,
      trialDays: row.trialDays,
      status: this.inviteStatus(row),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      tenantId: row.tenantId,
      inviteUrl: token ? this.inviteUrl(token) : null,
    };
  }

  private inviteUrl(token: string): string {
    return `${this.config.WEB_URL}/start/${token}`;
  }

  async listInvites(): Promise<OperatorInviteDto[]> {
    const rows = await this.db
      .select({ invite: operatorInvites, planName: platformPlans.name })
      .from(operatorInvites)
      .leftJoin(platformPlans, eq(platformPlans.id, operatorInvites.planId))
      .orderBy(desc(operatorInvites.createdAt))
      .limit(200);
    return rows.map((r) => this.inviteDto(r.invite, r.planName));
  }

  async createInvite(
    body: CreateOperatorInviteBody,
    actorUserId: string,
  ): Promise<OperatorInviteDto> {
    const plan = body.planId ? await this.subscriptions.plan(body.planId) : null;
    if (plan && !plan.isActive) throw new DomainError('this plan is no longer offered');
    const token = randomToken();
    const now = this.clock.now();
    const [row] = await this.db.transaction(async (tx) => {
      const created = await tx
        .insert(operatorInvites)
        .values({
          email: body.email,
          businessName: body.businessName,
          planId: body.planId,
          feeBpsOverride: body.feeBpsOverride,
          trialDays: body.trialDays,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
          createdByUserId: actorUserId,
        })
        .returning();
      await this.subscriptions.audit(
        tx,
        null,
        actorUserId,
        'invite.created',
        'invite',
        created[0]!.id,
        {
          email: body.email,
          businessName: body.businessName,
        },
      );
      return created;
    });
    await this.notifier.send({
      to: body.email,
      subject: `Invitație: ${body.businessName} pe platforma de afiliere`,
      text:
        `Bună! Ai fost invitat să deschizi contul de operator pentru ${body.businessName}. ` +
        `Intră cu adresa ${body.email} aici: ${this.inviteUrl(token)} (linkul e valabil 30 de zile).`,
    });
    return this.inviteDto(row!, plan?.name ?? null, token);
  }

  async revokeInvite(id: string, actorUserId: string): Promise<OperatorInviteDto> {
    const [row] = await this.db
      .update(operatorInvites)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(operatorInvites.id, id), isNull(operatorInvites.acceptedAt)))
      .returning();
    if (!row) throw new NotFound('pending invitation');
    await this.subscriptions.audit(this.db, null, actorUserId, 'invite.revoked', 'invite', id, {});
    return this.inviteDto(row, null);
  }

  private async pendingInvite(token: string, db: DbOrTx = this.db): Promise<InviteRow> {
    const [row] = await db
      .select()
      .from(operatorInvites)
      .where(eq(operatorInvites.tokenHash, hashToken(token)));
    if (!row) throw new NotFound('invitation');
    const status = this.inviteStatus(row);
    if (status !== 'pending') {
      throw new DomainError(
        status === 'accepted'
          ? 'this invitation was already used; sign in to open your account'
          : 'this invitation is no longer valid; ask for a new one',
        HttpStatus.GONE,
      );
    }
    return row;
  }

  async previewInvite(token: string): Promise<OperatorInvitePreviewDto> {
    const [row] = await this.db
      .select()
      .from(operatorInvites)
      .where(eq(operatorInvites.tokenHash, hashToken(token)));
    if (!row) throw new NotFound('invitation');
    const plan = row.planId
      ? await this.subscriptions.plan(row.planId)
      : await this.subscriptions.defaultPlan();
    return {
      email: row.email,
      businessName: row.businessName,
      plan: {
        name: plan.name,
        monthlyPriceMinor: plan.monthlyPriceMinor,
        currency: plan.currency,
        platformFeeBps: plan.platformFeeBps,
        maxAffiliates: plan.maxAffiliates,
      },
      trialDays: row.trialDays ?? plan.trialDays,
      platformFeeBps: row.feeBpsOverride ?? plan.platformFeeBps,
      status: this.inviteStatus(row),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Signup
  // -------------------------------------------------------------------------------------------

  async signupOptions(): Promise<SignupOptionsDto> {
    return {
      selfSignup: this.config.SELF_SIGNUP,
      plans: await this.subscriptions.publicPlans(),
    };
  }

  async checkSlug(raw: string): Promise<SlugCheckDto> {
    const wanted = raw.trim().toLowerCase();
    const valid = SLUG_PATTERN.test(wanted);
    const base = valid ? wanted : slugify(raw);
    const suggestion = await this.freeSlug(this.db, base);
    return { slug: wanted, available: valid && suggestion === wanted, suggestion };
  }

  private async freeSlug(db: DbOrTx, base: string): Promise<string> {
    const taken = new Set(
      (
        await db
          .select({ slug: tenants.slug })
          .from(tenants)
          .where(or(eq(tenants.slug, base), like(tenants.slug, `${base}-%`)))
      ).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Creates the operator account with the signed-in user as its owner. */
  async createTenant(userId: string, body: CreateTenantBody): Promise<CreateTenantResultDto> {
    if (!IANAZone.isValidZone(body.timezone)) {
      throw new DomainError(`unknown timezone "${body.timezone}"`, HttpStatus.BAD_REQUEST);
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new NotFound('user');

    if (!body.inviteToken) {
      if (!this.config.SELF_SIGNUP && !user.isPlatformAdmin) {
        throw new DomainError(
          'new operators join by invitation; ask us for one',
          HttpStatus.FORBIDDEN,
        );
      }
      const [owned] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')));
      if ((owned?.n ?? 0) >= MAX_OWNED_TENANTS && !user.isPlatformAdmin) {
        throw new DomainError('you already manage several operators; contact us to add more');
      }
    }

    const created = await this.db.transaction(async (tx) => {
      const invite = body.inviteToken ? await this.pendingInvite(body.inviteToken, tx) : null;
      if (invite && invite.email !== user.email) {
        throw new DomainError(
          `this invitation is for ${invite.email}; sign in with that address`,
          HttpStatus.FORBIDDEN,
        );
      }

      let slug: string;
      if (body.slug) {
        const [clash] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.slug, body.slug));
        if (clash) {
          throw new DomainError(`the address "${body.slug}" is taken`, HttpStatus.CONFLICT, {
            suggestion: await this.freeSlug(tx, body.slug),
          });
        }
        slug = body.slug;
      } else {
        slug = await this.freeSlug(tx, slugify(body.name));
      }

      const [tenant] = await tx
        .insert(tenants)
        .values({
          slug,
          name: body.name,
          currency: body.currency,
          timezone: body.timezone,
        })
        .returning();
      const tenantId = tenant!.id;
      await tx.insert(memberships).values({ userId, tenantId, role: 'owner' });
      if (body.ownerName && !user.name) {
        await tx.update(users).set({ name: body.ownerName }).where(eq(users.id, userId));
      }
      await this.subscriptions.start(tx, tenantId, {
        planId: invite?.planId ?? body.planId ?? null,
        feeBpsOverride: invite?.feeBpsOverride ?? null,
        trialDays: invite?.trialDays ?? null,
      });
      if (invite) {
        await tx
          .update(operatorInvites)
          .set({ acceptedAt: this.clock.now(), tenantId })
          .where(eq(operatorInvites.id, invite.id));
      }
      await this.subscriptions.audit(tx, tenantId, userId, 'tenant.created', 'tenant', tenantId, {
        name: body.name,
        slug,
        via: invite ? 'invite' : 'signup',
      });
      return { tenantId, slug };
    });

    for (const admin of this.config.PLATFORM_ADMIN_EMAILS) {
      await this.notifier
        .send({
          to: admin,
          subject: `Operator nou: ${body.name}`,
          text: `${body.name} și-a deschis contul (${user.email ?? user.phone}). Vezi-l în ${this.config.WEB_URL}/admin/operators/${created.tenantId}`,
        })
        .catch(() => undefined);
    }
    return created;
  }

  // -------------------------------------------------------------------------------------------
  // Guided setup
  // -------------------------------------------------------------------------------------------

  async setup(tenantId: string): Promise<OnboardingDto> {
    const exists = (table: typeof products | typeof commissionPlans | typeof affiliates) =>
      sql<boolean>`exists (select 1 from ${table} where ${table.tenantId} = ${tenantId})`;
    const [row] = await this.db
      .select({
        product: exists(products),
        commissionPlan: exists(commissionPlans),
        affiliate: exists(affiliates),
        departures: sql<boolean>`exists (select 1 from ${slots} where ${slots.tenantId} = ${tenantId})
          or exists (select 1 from ${availabilitySources} where ${availabilitySources.tenantId} = ${tenantId})`,
        firstBooking: sql<boolean>`exists (select 1 from ${bookings} where ${bookings.tenantId} = ${tenantId}
          and ${bookings.status} = 'confirmed')`,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row) throw new NotFound('operator');
    const steps: { key: OnboardingStepKey; done: boolean }[] = [
      { key: 'product', done: row.product },
      { key: 'departures', done: row.departures },
      { key: 'commission_plan', done: row.commissionPlan },
      { key: 'affiliate', done: row.affiliate },
      { key: 'first_booking', done: row.firstBooking },
    ];
    return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
  }
}
