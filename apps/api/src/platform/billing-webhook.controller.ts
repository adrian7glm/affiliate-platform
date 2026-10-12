import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { type Database, processedWebhookEvents } from '@ap/db';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { DomainError, NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { BillingGateway, StripeBilling } from './billing.gateway';
import { SubscriptionsService } from './subscriptions.service';

const idOf = (value: string | { id: string } | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.id;

/**
 * Stripe Billing events for operators' subscriptions. A separate endpoint (and signing secret)
 * from booking payments, so either can be switched on alone.
 */
@Controller('webhooks/stripe/billing')
export class BillingWebhookController {
  private readonly logger = new Logger('BillingWebhook');

  constructor(
    private readonly billing: BillingGateway,
    private readonly subscriptions: SubscriptionsService,
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!(this.billing instanceof StripeBilling)) throw new NotFound('page');
    let event: Stripe.Event;
    try {
      event = this.billing.stripe.webhooks.constructEvent(
        request.rawBody ?? Buffer.alloc(0),
        signature ?? '',
        this.config.STRIPE_BILLING_WEBHOOK_SECRET ?? '',
      );
    } catch {
      throw new DomainError('errors.webhooks.invalidSignature', HttpStatus.BAD_REQUEST);
    }

    const [seen] = await this.db
      .select({ id: processedWebhookEvents.id })
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.id, event.id));
    if (seen) return { received: true };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const subscriptionId = idOf(session.subscription);
        if (session.mode === 'subscription' && subscriptionId) {
          const subscription = await this.billing.stripe.subscriptions.retrieve(subscriptionId);
          await this.apply(subscription, session.client_reference_id);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.apply(event.data.object, null);
        break;
      default:
        this.logger.debug(`ignored Stripe event ${event.type}`);
    }

    await this.db
      .insert(processedWebhookEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing();
    return { received: true };
  }

  private async apply(subscription: Stripe.Subscription, tenantId: string | null): Promise<void> {
    const item = subscription.items.data[0];
    await this.subscriptions.applyStripeSubscription({
      tenantId: tenantId ?? subscription.metadata?.tenantId ?? null,
      customerId: idOf(subscription.customer)!,
      subscriptionId: subscription.id,
      status: subscription.status,
      priceId: item?.price.id ?? null,
      currentPeriodEnd: item?.current_period_end ?? null,
      trialEnd: subscription.trial_end,
    });
  }
}
