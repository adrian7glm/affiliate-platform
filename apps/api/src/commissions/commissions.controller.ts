import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { periodKeyFor, periodRange } from '@ap/commission';
import {
  type AffiliateHomeDto,
  type ClosePeriodBody,
  type ClosePeriodResultDto,
  type CommissionPlanDto,
  type CommissionReportDto,
  type CreatePlanBody,
  type EarningsDto,
  type OperatorDashboardDto,
  type PayoutDto,
  closePeriodBody,
  createPlanBody,
} from '@ap/contracts';
import { type Database, affiliates, bookings, commissionEntries } from '@ap/db';
import { and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import {
  AuthGuard,
  CurrentAffiliate,
  CurrentTenant,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { Clock } from '../common/clock';
import { periodOrCurrent } from '../common/period';
import { TenantsService } from '../common/tenants';
import { ZodBody } from '../common/validation';
import { DB } from '../database/database.module';
import { CommissionsService } from './commissions.service';

@Controller('affiliate')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateCommissionsController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
  ) {}

  @Get('home')
  home(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
  ): Promise<AffiliateHomeDto> {
    return this.commissions.home(tenant.tenantId, affiliateId);
  }

  @Get('earnings')
  async earnings(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
    @Query('period') period: unknown,
  ): Promise<EarningsDto> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.commissions.earnings(
      tenant.tenantId,
      affiliateId,
      periodOrCurrent(period, this.clock.now(), timezone),
    );
  }
}

@Controller('operator')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorCommissionsController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get('commission-plans')
  plans(@CurrentTenant() tenant: TenantContext): Promise<CommissionPlanDto[]> {
    return this.commissions.listPlans(tenant.tenantId);
  }

  @Post('commission-plans')
  createPlan(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(createPlanBody) body: CreatePlanBody,
  ): Promise<CommissionPlanDto> {
    return this.commissions.createPlan(tenant.tenantId, body);
  }

  @Get('commissions/report')
  async report(
    @CurrentTenant() tenant: TenantContext,
    @Query('period') period: unknown,
  ): Promise<CommissionReportDto> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.commissions.report(
      tenant.tenantId,
      periodOrCurrent(period, this.clock.now(), timezone),
    );
  }

  @Post('payouts/close-period')
  @HttpCode(200)
  closePeriod(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(closePeriodBody) body: ClosePeriodBody,
  ): Promise<ClosePeriodResultDto> {
    return this.commissions.closePeriod(tenant.tenantId, body.periodKey);
  }

  @Get('payouts')
  async payouts(
    @CurrentTenant() tenant: TenantContext,
    @Query('period') period: unknown,
  ): Promise<PayoutDto[]> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.commissions.listPayouts(
      tenant.tenantId,
      periodOrCurrent(period, this.clock.now(), timezone),
    );
  }

  @Post('payouts/:id/mark-paid')
  @HttpCode(200)
  markPaid(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PayoutDto> {
    return this.commissions.markPaid(tenant.tenantId, id);
  }

  @Get('dashboard')
  async dashboard(@CurrentTenant() context: TenantContext): Promise<OperatorDashboardDto> {
    const tenant = await this.tenants.get(context.tenantId);
    const periodKey = periodKeyFor(this.clock.now(), tenant.timezone);
    const { start, end } = periodRange(periodKey, tenant.timezone);
    const paidInMonth = and(
      eq(bookings.tenantId, tenant.id),
      eq(bookings.status, 'confirmed'),
      gte(bookings.paidAt, start),
      lt(bookings.paidAt, end),
    );
    const [sales] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .where(paidInMonth);
    const [commission] = await this.db
      .select({ total: sql<number>`coalesce(sum(${commissionEntries.amountMinor}), 0)::int` })
      .from(commissionEntries)
      .where(
        and(eq(commissionEntries.tenantId, tenant.id), eq(commissionEntries.periodKey, periodKey)),
      );
    const statuses = await this.db
      .select({ status: affiliates.status, count: sql<number>`count(*)::int` })
      .from(affiliates)
      .where(eq(affiliates.tenantId, tenant.id))
      .groupBy(affiliates.status);
    const top = await this.db
      .select({
        affiliateId: affiliates.id,
        name: affiliates.displayName,
        paidSales: sql<number>`count(*)::int`,
        salesMinor: sql<number>`coalesce(sum(${bookings.totalMinor}), 0)::int`,
      })
      .from(bookings)
      .innerJoin(affiliates, eq(affiliates.id, bookings.affiliateId))
      .where(and(paidInMonth, isNotNull(bookings.affiliateId)))
      .groupBy(affiliates.id, affiliates.displayName)
      .orderBy(desc(sql`count(*)`))
      .limit(5);
    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        currency: tenant.currency,
        timezone: tenant.timezone,
      },
      periodKey,
      bookings: { count: sales?.count ?? 0, revenueMinor: sales?.revenue ?? 0 },
      commissions: { totalMinor: commission?.total ?? 0 },
      affiliates: {
        active: statuses.find((s) => s.status === 'active')?.count ?? 0,
        invited: statuses.find((s) => s.status === 'invited')?.count ?? 0,
      },
      topAffiliates: top,
    };
  }
}
