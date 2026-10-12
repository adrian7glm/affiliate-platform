import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import {
  type AdminOverviewDto,
  type AdminOverviewQuery,
  type AdminTenantDetailDto,
  type CreateOperatorInviteBody,
  type CreatePlatformPlanBody,
  type OperatorInviteDto,
  type PlatformPlanDto,
  type SubscriptionDto,
  type UpdatePlatformPlanBody,
  type UpdateTenantBillingBody,
  type UpdateTenantStatusBody,
  adminOverviewQuery,
  createOperatorInviteBody,
  createPlatformPlanBody,
  updatePlatformPlanBody,
  updateTenantBillingBody,
  updateTenantStatusBody,
} from '@ap/contracts';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { ZodBody, ZodQuery } from '../common/validation';
import { AdminService } from './admin.service';
import { OnboardingService } from './onboarding.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SubscriptionsService } from './subscriptions.service';

/** The platform owner's area: every operator, plans and fees, invitations. */
@Controller('admin')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly subscriptions: SubscriptionsService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get('overview')
  overview(@ZodQuery(adminOverviewQuery) query: AdminOverviewQuery): Promise<AdminOverviewDto> {
    return this.admin.overview(query.period);
  }

  @Get('tenants/:id')
  tenant(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTenantDetailDto> {
    return this.admin.tenant(id);
  }

  @Patch('tenants/:id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTenantStatusBody) body: UpdateTenantStatusBody,
  ): Promise<AdminTenantDetailDto> {
    return this.admin.setStatus(id, body, user.id);
  }

  @Patch('tenants/:id/billing')
  setBilling(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTenantBillingBody) body: UpdateTenantBillingBody,
  ): Promise<SubscriptionDto> {
    return this.subscriptions.adminUpdate(id, body, user.id);
  }

  @Get('plans')
  plans(): Promise<PlatformPlanDto[]> {
    return this.subscriptions.listPlans();
  }

  @Post('plans')
  createPlan(
    @CurrentUser() user: AuthUser,
    @ZodBody(createPlatformPlanBody) body: CreatePlatformPlanBody,
  ): Promise<PlatformPlanDto> {
    return this.subscriptions.createPlan(body, user.id);
  }

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updatePlatformPlanBody) body: UpdatePlatformPlanBody,
  ): Promise<PlatformPlanDto> {
    return this.subscriptions.updatePlan(id, body, user.id);
  }

  @Get('invites')
  invites(): Promise<OperatorInviteDto[]> {
    return this.onboarding.listInvites();
  }

  @Post('invites')
  invite(
    @CurrentUser() user: AuthUser,
    @ZodBody(createOperatorInviteBody) body: CreateOperatorInviteBody,
  ): Promise<OperatorInviteDto> {
    return this.onboarding.createInvite(body, user.id);
  }

  @Post('invites/:id/revoke')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OperatorInviteDto> {
    return this.onboarding.revokeInvite(id, user.id);
  }
}
