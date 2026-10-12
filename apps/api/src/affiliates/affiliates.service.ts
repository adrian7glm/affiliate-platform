import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { periodKeyFor, periodRange } from '@ap/commission';
import type {
  AffiliateDto,
  AffiliateWithStatsDto,
  InviteAffiliateBody,
  InvitePreviewDto,
  MeDto,
  UpdateAffiliateBody,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  commissionEntries,
  memberships,
  tenants,
  users,
} from '@ap/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { randomToken } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { Notifier } from '../common/notifier';
import { TenantsService } from '../common/tenants';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { CommissionsService } from '../commissions/commissions.service';
import { IdentityService } from '../identity/identity.service';
import { LinksService } from '../tracking/links.service';
import { col } from '../common/sql';

const INVITE_TTL_MS = 14 * 24 * 3_600_000;
type AffiliateRow = typeof affiliates.$inferSelect;

/** The operator's network of affiliates: invitations, rates, suspension. */
@Injectable()
export class AffiliatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly identity: IdentityService,
    private readonly commissions: CommissionsService,
    private readonly links: LinksService,
    private readonly notifier: Notifier,
  ) {}

  private dto(row: AffiliateRow): AffiliateDto {
    return {
      id: row.id,
      displayName: row.displayName,
      type: row.type,
      status: row.status,
      commissionPlanId: row.commissionPlanId,
      commissionRateBpsOverride: row.commissionRateBpsOverride,
      parentAffiliateId: row.parentAffiliateId,
      inviteUrl: row.inviteToken ? `${this.config.WEB_URL}/join/${row.inviteToken}` : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(tenantId: string): Promise<AffiliateWithStatsDto[]> {
    const tenant = await this.tenants.get(tenantId);
    const periodKey = periodKeyFor(this.clock.now(), tenant.timezone);
    const { start, end } = periodRange(periodKey, tenant.timezone);
    const rows = await this.db
      .select({
        affiliate: affiliates,
        paidSales: sql<number>`(select count(*)::int from ${bookings} where ${col(bookings.affiliateId)} = ${col(affiliates.id)}
          and ${col(bookings.status)} = 'confirmed' and ${col(bookings.paidAt)} >= ${start} and ${col(bookings.paidAt)} < ${end})`,
        earnedMinor: sql<number>`(select coalesce(sum(${col(commissionEntries.amountMinor)}), 0)::int from ${commissionEntries}
          where ${col(commissionEntries.affiliateId)} = ${col(affiliates.id)} and ${col(commissionEntries.periodKey)} = ${periodKey})`,
      })
      .from(affiliates)
      .where(eq(affiliates.tenantId, tenantId))
      .orderBy(asc(affiliates.displayName));
    return rows.map((r) => ({
      ...this.dto(r.affiliate),
      month: {
        periodKey,
        paidSales: r.paidSales,
        earnedMinor: r.earnedMinor,
        currency: tenant.currency,
      },
    }));
  }

  async invite(tenantId: string, body: InviteAffiliateBody): Promise<AffiliateDto> {
    const tenant = await this.tenants.get(tenantId);
    await this.commissions.assertPlanBelongs(tenantId, body.commissionPlanId);
    if (body.parentAffiliateId) await this.get(tenantId, body.parentAffiliateId);
    const token = randomToken();
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(affiliates)
        .values({
          tenantId,
          displayName: body.displayName,
          type: body.type,
          status: 'invited',
          commissionPlanId: body.commissionPlanId ?? null,
          commissionRateBpsOverride: body.commissionRateBpsOverride ?? null,
          parentAffiliateId: body.parentAffiliateId ?? null,
          inviteToken: token,
          inviteExpiresAt: new Date(this.clock.now().getTime() + INVITE_TTL_MS),
        })
        .returning();
      await this.links.primaryLinkId(tx, tenantId, created!.id);
      return created!;
    });
    if (body.destination) {
      await this.notifier.send({
        to: body.destination,
        subject: `${tenant.name} te invită în rețeaua de afiliați`,
        text: `${tenant.name} te invită să recomanzi excursiile lor și să câștigi comision. Activează-ți contul: ${this.config.WEB_URL}/join/${token}`,
      });
    }
    return this.dto(row);
  }

  async get(tenantId: string, affiliateId: string): Promise<AffiliateRow> {
    const [row] = await this.db
      .select()
      .from(affiliates)
      .where(and(eq(affiliates.id, affiliateId), eq(affiliates.tenantId, tenantId)));
    if (!row) throw new NotFound('affiliate');
    return row;
  }

  async update(
    tenantId: string,
    affiliateId: string,
    body: UpdateAffiliateBody,
  ): Promise<AffiliateDto> {
    const current = await this.get(tenantId, affiliateId);
    await this.commissions.assertPlanBelongs(tenantId, body.commissionPlanId);
    if (body.status === 'active' && current.status === 'invited') {
      throw new DomainError(
        'the affiliate has not accepted the invitation yet',
        HttpStatus.CONFLICT,
      );
    }
    const [row] = await this.db
      .update(affiliates)
      .set({
        displayName: body.displayName,
        status: body.status,
        commissionPlanId: body.commissionPlanId,
        commissionRateBpsOverride: body.commissionRateBpsOverride,
      })
      .where(eq(affiliates.id, affiliateId))
      .returning();
    return this.dto(row!);
  }

  async preview(token: string): Promise<InvitePreviewDto> {
    const [row] = await this.db
      .select({ affiliate: affiliates, tenantName: tenants.name })
      .from(affiliates)
      .innerJoin(tenants, eq(tenants.id, affiliates.tenantId))
      .where(eq(affiliates.inviteToken, token));
    if (!row) throw new NotFound('invitation');
    return {
      tenantName: row.tenantName,
      affiliateName: row.affiliate.displayName,
      expired: !row.affiliate.inviteExpiresAt || row.affiliate.inviteExpiresAt < this.clock.now(),
    };
  }

  async accept(userId: string, token: string, name: string | undefined): Promise<MeDto> {
    await this.db.transaction(async (tx) => {
      const [affiliate] = await tx
        .select()
        .from(affiliates)
        .where(eq(affiliates.inviteToken, token))
        .for('update');
      if (!affiliate || affiliate.status !== 'invited') throw new NotFound('invitation');
      if (!affiliate.inviteExpiresAt || affiliate.inviteExpiresAt < this.clock.now()) {
        throw new DomainError(
          'this invitation has expired, ask the operator for a new one',
          HttpStatus.GONE,
        );
      }
      const [existing] = await tx
        .select({ id: affiliates.id })
        .from(affiliates)
        .where(and(eq(affiliates.tenantId, affiliate.tenantId), eq(affiliates.userId, userId)));
      if (existing)
        throw new DomainError('you are already an affiliate of this operator', HttpStatus.CONFLICT);
      await tx
        .update(affiliates)
        .set({ userId, status: 'active', inviteToken: null, inviteExpiresAt: null })
        .where(eq(affiliates.id, affiliate.id));
      await tx
        .insert(memberships)
        .values({ userId, tenantId: affiliate.tenantId, role: 'affiliate' })
        .onConflictDoNothing();
      if (name) {
        await tx
          .update(users)
          .set({ name })
          .where(and(eq(users.id, userId), sql`${users.name} is null`));
      }
    });
    return this.identity.me(userId);
  }
}
