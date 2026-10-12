import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  type ConnectSourceBody,
  type SourceDto,
  type SyncResultDto,
  connectSourceBody,
} from '@ap/contracts';
import { AuthGuard, CurrentTenant, Roles, type TenantContext, TenantGuard } from '../common/auth';
import { ZodBody } from '../common/validation';
import { SourcesService } from './sources.service';

@Controller('operator/sources')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorSourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<SourceDto[]> {
    return this.sources.list(tenant.tenantId);
  }

  @Post()
  @Roles('owner')
  connect(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(connectSourceBody) body: ConnectSourceBody,
  ): Promise<SourceDto> {
    return this.sources.connect(tenant.tenantId, body);
  }

  @Post(':id/sync')
  @HttpCode(200)
  sync(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SyncResultDto> {
    return this.sources.sync(tenant.tenantId, id);
  }
}
