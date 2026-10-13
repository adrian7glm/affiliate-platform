import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BillingGateway, ManualBilling, StripeBilling } from './billing.gateway';
import { BillingWebhookController } from './billing-webhook.controller';
import { AdminContactController, PublicContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { OnboardingService } from './onboarding.service';
import { OperatorPlatformController, SignupController } from './onboarding.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The platform owner's business: plans and fees sold to operators, operator onboarding and
 * billing, the contact page inbox, and the super-admin area. Reads other modules' tables only
 * for reporting.
 */
@Module({
  providers: [
    {
      provide: BillingGateway,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): BillingGateway =>
        config.BILLING_PROVIDER === 'stripe' ? new StripeBilling(config) : new ManualBilling(),
    },
    SubscriptionsService,
    OnboardingService,
    AdminService,
    ContactService,
    PlatformAdminGuard,
  ],
  controllers: [
    AdminController,
    SignupController,
    OperatorPlatformController,
    BillingWebhookController,
    PublicContactController,
    AdminContactController,
  ],
  exports: [SubscriptionsService],
})
export class PlatformModule {}
