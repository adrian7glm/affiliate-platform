import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  type AcceptInviteBody,
  type AffiliateDto,
  type AffiliateWithStatsDto,
  type InviteAffiliateBody,
  type InvitePreviewDto,
  type MeDto,
  type UpdateAffiliateBody,
  acceptInviteBody,
  inviteAffiliateBody,
  updateAffiliateBody,
} from '@ap/contracts';
import {
  type AuthUser,
  AuthGuard,
  CurrentTenant,
  CurrentUser,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { ZodBody } from '../common/validation';
import { AffiliatesService } from './affiliates.service';

@Controller('operator/affiliates')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorAffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<AffiliateWithStatsDto[]> {
    return this.affiliates.list(tenant.tenantId);
  }

  @Post()
  invite(
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(inviteAffiliateBody) body: InviteAffiliateBody,
  ): Promise<AffiliateDto> {
    return this.affiliates.invite(tenant.tenantId, body, tenant.roles.includes('owner'));
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateAffiliateBody) body: UpdateAffiliateBody,
  ): Promise<AffiliateDto> {
    return this.affiliates.update(tenant.tenantId, id, body, tenant.roles.includes('owner'));
  }
}

@Controller('invites')
export class InvitesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get(':token')
  preview(@Param('token') token: string): Promise<InvitePreviewDto> {
    return this.affiliates.preview(token);
  }

  @Post('accept')
  @UseGuards(AuthGuard)
  accept(
    @CurrentUser() user: AuthUser,
    @ZodBody(acceptInviteBody) body: AcceptInviteBody,
  ): Promise<MeDto> {
    return this.affiliates.accept(user.id, body.token, body.name);
  }
}
