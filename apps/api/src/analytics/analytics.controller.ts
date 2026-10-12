import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { OperatorAnalyticsDto } from '@ap/contracts';
import { AuthGuard, CurrentTenant, Roles, type TenantContext, TenantGuard } from '../common/auth';
import { Clock } from '../common/clock';
import { periodOrCurrent } from '../common/period';
import { TenantsService } from '../common/tenants';
import { AnalyticsService } from './analytics.service';

@Controller('operator')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
  ) {}

  @Get('analytics')
  async month(
    @CurrentTenant() context: TenantContext,
    @Query('period') period: unknown,
  ): Promise<OperatorAnalyticsDto> {
    const tenant = await this.tenants.get(context.tenantId);
    return this.analytics.month(tenant, periodOrCurrent(period, this.clock.now(), tenant.timezone));
  }
}
