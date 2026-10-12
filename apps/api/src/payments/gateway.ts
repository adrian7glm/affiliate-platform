export interface CheckoutLine {
  name: string;
  unitAmountMinor: number;
  quantity: number;
}

export interface CheckoutInput {
  bookingId: string;
  tenantId: string;
  reference: string;
  currency: string;
  lines: CheckoutLine[];
  totalMinor: number;
  customerEmail: string | null;
  locale: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  /** Operator's connected Stripe account; the operator is the merchant of record. */
  connectedAccountId: string | null;
  /** What the platform keeps: its fee (and in v2, the affiliate commission). */
  applicationFeeMinor: number;
}

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

/** The only place that talks to the payment provider. */
export abstract class PaymentsGateway {
  abstract readonly name: 'stripe' | 'fake';
  abstract createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  /** `connected`: the charge was transferred to the operator's account and must be reversed. */
  abstract refund(
    paymentIntentId: string | null,
    amountMinor: number,
    connected: boolean,
  ): Promise<{ refundId: string }>;
}
