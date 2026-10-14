import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AffiliateHomeDto,
  type ArchivePlanResultDto,
  type ClosePeriodBody,
  type ClosePeriodResultDto,
  type CommissionPlanDto,
  type CommissionReportDto,
  type CreatePlanBody,
  type EarningsDto,
  type PayoutDto,
  type UpdatePlanBody,
  closePeriodBody,
  createPlanBody,
  updatePlanBody,
} from '@ap/contracts';
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
import { AffiliateEarningsService } from './affiliate-earnings.service';
import { CommissionPlansService } from './commission-plans.service';
import { CommissionPayoutsService } from './payouts.service';

@Controller('affiliate')
@UseGuards(AuthGuard, TenantGuard)
@Roles('affiliate')
export class AffiliateCommissionsController {
  constructor(
    private readonly earningsService: AffiliateEarningsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
  ) {}

  @Get('home')
  home(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
  ): Promise<AffiliateHomeDto> {
    return this.earningsService.home(tenant.tenantId, affiliateId);
  }

  @Get('earnings')
  async earnings(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAffiliate() affiliateId: string,
    @Query('period') period: unknown,
  ): Promise<EarningsDto> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.earningsService.earnings(
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
    private readonly plansService: CommissionPlansService,
    private readonly payoutsService: CommissionPayoutsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
  ) {}

  @Get('commission-plans')
  plans(@CurrentTenant() tenant: TenantContext): Promise<CommissionPlanDto[]> {
    return this.plansService.listPlans(tenant.tenantId);
  }

  @Post('commission-plans')
  createPlan(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(createPlanBody) body: CreatePlanBody,
  ): Promise<CommissionPlanDto> {
    return this.plansService.createPlan(tenant.tenantId, body);
  }

  @Put('commission-plans/:id')
  updatePlan(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updatePlanBody) body: UpdatePlanBody,
  ): Promise<CommissionPlanDto> {
    return this.plansService.updatePlan(tenant.tenantId, id, body);
  }

  @Post('commission-plans/:id/make-default')
  @HttpCode(200)
  makeDefault(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommissionPlanDto> {
    return this.plansService.makeDefaultPlan(tenant.tenantId, id);
  }

  @Delete('commission-plans/:id')
  archivePlan(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ArchivePlanResultDto> {
    return this.plansService.archivePlan(tenant.tenantId, id);
  }

  @Get('commissions/report')
  async report(
    @CurrentTenant() tenant: TenantContext,
    @Query('period') period: unknown,
  ): Promise<CommissionReportDto> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.payoutsService.report(
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
    return this.payoutsService.closePeriod(tenant.tenantId, body.periodKey);
  }

  @Get('payouts')
  async payouts(
    @CurrentTenant() tenant: TenantContext,
    @Query('period') period: unknown,
  ): Promise<PayoutDto[]> {
    const { timezone } = await this.tenants.get(tenant.tenantId);
    return this.payoutsService.listPayouts(
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
    return this.payoutsService.markPaid(tenant.tenantId, id);
  }
}
