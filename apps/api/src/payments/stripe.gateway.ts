import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { APP_CONFIG, type AppConfig } from '../config';
import { type CheckoutInput, type CheckoutSession, PaymentsGateway } from './gateway';

const STRIPE_LOCALES = new Set(['ro', 'en', 'de', 'fr', 'it']);
/** Stripe requires a Checkout Session to stay open at least 30 minutes. */
const MIN_SESSION_MS = 31 * 60_000;

@Injectable()
export class StripeGateway extends PaymentsGateway {
  readonly name = 'stripe' as const;
  readonly stripe: Stripe;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY ?? '');
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const expiresAt = Math.max(input.expiresAt.getTime(), Date.now() + MIN_SESSION_MS);
    const metadata = {
      bookingId: input.bookingId,
      tenantId: input.tenantId,
      reference: input.reference,
    };
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: input.bookingId,
        customer_email: input.customerEmail ?? undefined,
        locale: (STRIPE_LOCALES.has(input.locale)
          ? input.locale
          : 'auto') as Stripe.Checkout.SessionCreateParams.Locale,
        line_items: input.lines.map((line) => ({
          quantity: line.quantity,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: line.unitAmountMinor,
            product_data: { name: line.name },
          },
        })),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.floor(expiresAt / 1000),
        metadata,
        payment_intent_data: input.connectedAccountId
          ? {
              metadata,
              on_behalf_of: input.connectedAccountId,
              transfer_data: { destination: input.connectedAccountId },
              application_fee_amount: input.applicationFeeMinor,
            }
          : { metadata },
      },
      { idempotencyKey: `checkout-${input.bookingId}` },
    );
    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { sessionId: session.id, url: session.url };
  }

  async refund(
    paymentIntentId: string | null,
    amountMinor: number,
    connected: boolean,
  ): Promise<{ refundId: string }> {
    if (!paymentIntentId) throw new Error('cannot refund a payment without a payment intent');
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountMinor,
        // With destination charges, take the money back from the operator and return the platform fee.
        ...(connected ? { reverse_transfer: true, refund_application_fee: true } : {}),
      },
      // A retried cancellation never refunds twice.
      { idempotencyKey: `refund-${paymentIntentId}-${amountMinor}` },
    );
    return { refundId: refund.id };
  }
}
