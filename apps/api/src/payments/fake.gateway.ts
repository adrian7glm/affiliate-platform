import { APP_CONFIG, type AppConfig } from '../config';
import { Inject, Injectable } from '@nestjs/common';
import { ticketLinkKey } from '../common/crypto';
import { type CheckoutInput, type CheckoutSession, PaymentsGateway } from './gateway';

/**
 * Local development and tests: the "payment page" is a page of the web app that calls
 * POST /public/dev-payments/:bookingId/succeed. Refused in production by config validation.
 */
@Injectable()
export class FakeGateway extends PaymentsGateway {
  readonly name = 'fake' as const;
  readonly refunds: { paymentIntentId: string | null; amountMinor: number }[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const key = ticketLinkKey(this.config.APP_SECRET, input.bookingId);
    return {
      sessionId: `fake_cs_${input.bookingId}`,
      url: `${this.config.WEB_URL}/dev/pay/${input.bookingId}?k=${key}`,
    };
  }

  async refund(
    paymentIntentId: string | null,
    amountMinor: number,
    _connected: boolean,
  ): Promise<{ refundId: string }> {
    this.refunds.push({ paymentIntentId, amountMinor });
    return { refundId: `fake_re_${this.refunds.length}` };
  }
}
