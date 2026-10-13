import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  type BillingRedirectDto,
  type CreateTenantBody,
  type CreateTenantResultDto,
  type OnboardingDto,
  type OperatorBillingDto,
  type OperatorInvitePreviewDto,
  type SignupOptionsDto,
  type SlugCheckDto,
  type StartSubscriptionBody,
  createTenantBody,
  startSubscriptionBody,
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
import { BillingGateway } from './billing.gateway';
import { OnboardingService } from './onboarding.service';
import { SubscriptionsService } from './subscriptions.service';

/** Becoming an operator: plans on offer, invitations, creating the account. */
@Controller('signup')
export class SignupController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('options')
  options(): Promise<SignupOptionsDto> {
    return this.onboarding.signupOptions();
  }

  @Get('slug')
  slug(@Query('slug') slug = ''): Promise<SlugCheckDto> {
    return this.onboarding.checkSlug(slug.slice(0, 80));
  }

  @Get('invites/:token')
  invite(@Param('token') token: string): Promise<OperatorInvitePreviewDto> {
    return this.onboarding.previewInvite(token);
  }

  @Post('tenants')
  @UseGuards(AuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @ZodBody(createTenantBody) body: CreateTenantBody,
  ): Promise<CreateTenantResultDto> {
    return this.onboarding.createTenant(user.id, body);
  }
}

/** The operator's guided setup and their subscription to the platform. */
@Controller('operator')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class OperatorPlatformController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly subscriptions: SubscriptionsService,
    private readonly billing: BillingGateway,
  ) {}

  @Get('onboarding')
  setup(@CurrentTenant() tenant: TenantContext): Promise<OnboardingDto> {
    return this.onboarding.setup(tenant.tenantId);
  }

  @Get('billing')
  async billingState(@CurrentTenant() tenant: TenantContext): Promise<OperatorBillingDto> {
    const [subscription, plans, feesThisMonth] = await Promise.all([
      this.subscriptions.forTenant(tenant.tenantId),
      this.subscriptions.publicPlans(),
      this.subscriptions.feesThisMonth(tenant.tenantId),
    ]);
    const provider = this.billing.name === 'stripe' ? 'stripe' : 'manual';
    return { subscription, plans, provider, feesThisMonth };
  }

  @Post('billing/checkout')
  @Roles('owner')
  checkout(
    @CurrentUser() user: AuthUser,
    @CurrentTenant() tenant: TenantContext,
    @ZodBody(startSubscriptionBody) body: StartSubscriptionBody,
  ): Promise<BillingRedirectDto> {
    return this.subscriptions.checkout(tenant.tenantId, user.id, body.planId);
  }

  @Post('billing/portal')
  @Roles('owner')
  portal(@CurrentTenant() tenant: TenantContext): Promise<BillingRedirectDto> {
    return this.subscriptions.portal(tenant.tenantId);
  }
}
