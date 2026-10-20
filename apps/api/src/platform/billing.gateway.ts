import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { APP_CONFIG, type AppConfig } from '../config';

export interface SubscriptionCheckoutInput {
  tenantId: string;
  tenantName: string;
  email: string | null;
  stripeCustomerId: string | null;
  stripePriceId: string;
  /** Days of free trial still left; Stripe starts charging after them. */
  trialDays: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * How operators pay the platform's subscription. `manual`: the platform owner invoices them
 * and marks the subscription paid. `stripe`: Stripe Billing charges their card every month.
 */
export abstract class BillingGateway {
  abstract readonly name: 'manual' | 'stripe';
  /** Returns the Stripe Checkout URL and the customer it was created for. */
  abstract createCheckout(
    input: SubscriptionCheckoutInput,
  ): Promise<{ url: string; customerId: string }>;
  abstract createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Moves an existing Stripe subscription to another price, prorated. */
  abstract changePrice(subscriptionId: string, stripePriceId: string): Promise<void>;
  /**
   * A subscription of this customer that still bills (or will), other than `except`: one a
   * completed checkout created before its webhook arrived, or a duplicate. Null when none.
   */
  abstract liveSubscriptionId(customerId: string, except?: string): Promise<string | null>;
}

/** Stripe subscription statuses that are, or can still become, paid. */
const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'paused']);

@Injectable()
export class ManualBilling extends BillingGateway {
  readonly name = 'manual' as const;

  async createCheckout(): Promise<{ url: string; customerId: string }> {
    throw new Error('manual billing has no checkout');
  }

  async createPortal(): Promise<{ url: string }> {
    throw new Error('manual billing has no customer portal');
  }

  async changePrice(): Promise<void> {
    // Nothing to tell anyone: the next invoice uses the new plan.
  }

  async liveSubscriptionId(): Promise<string | null> {
    return null;
  }
}

@Injectable()
export class StripeBilling extends BillingGateway {
  readonly name = 'stripe' as const;
  readonly stripe: Stripe;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY ?? '');
  }

  async createCheckout(
    input: SubscriptionCheckoutInput,
  ): Promise<{ url: string; customerId: string }> {
    const customerId =
      input.stripeCustomerId ??
      (
        await this.stripe.customers.create(
          {
            name: input.tenantName,
            email: input.email ?? undefined,
            metadata: { tenantId: input.tenantId },
          },
          { idempotencyKey: `customer-${input.tenantId}` },
        )
      ).id;
    const metadata = {
      tenantId: input.tenantId,
      stripePriceId: input.stripePriceId,
      trialDays: String(input.trialDays),
    };
    if (input.stripeCustomerId) {
      // A checkout opened earlier (another tab, a double click) is reused when it sells the same
      // thing, and closed otherwise, so the operator can never complete two of them.
      const open = await this.stripe.checkout.sessions.list({
        customer: customerId,
        status: 'open',
        limit: 10,
      });
      for (const previous of open.data) {
        const same =
          previous.client_reference_id === input.tenantId &&
          previous.metadata?.stripePriceId === metadata.stripePriceId &&
          previous.metadata?.trialDays === metadata.trialDays;
        if (same && previous.url) return { url: previous.url, customerId };
        await this.stripe.checkout.sessions.expire(previous.id).catch(() => {
          // Completed or expired in the meantime: nothing left to close.
        });
      }
    }
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: input.tenantId,
      line_items: [{ price: input.stripePriceId, quantity: 1 }],
      subscription_data: {
        metadata: { tenantId: input.tenantId },
        ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
      },
      metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { url: session.url, customerId };
  }

  async createPortal(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  async changePrice(subscriptionId: string, stripePriceId: string): Promise<void> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) throw new Error(`Stripe subscription ${subscriptionId} has no items`);
    await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: stripePriceId }],
      proration_behavior: 'create_prorations',
    });
  }

  async liveSubscriptionId(customerId: string, except?: string): Promise<string | null> {
    const subscriptions = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 20,
    });
    return (
      subscriptions.data.find((s) => s.id !== except && LIVE_STATUSES.has(s.status))?.id ?? null
    );
  }
}
