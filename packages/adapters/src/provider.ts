/**
 * The single contract between the platform and an operator's availability system.
 * The core never knows whether seats live in our own calendar, behind the operator's API or in a
 * well-known booking system: each operator is connected through one AvailabilityProvider.
 */

export interface ProviderPrice {
  code: string;
  label: string;
  amountMinor: number;
  taxRateBps: number;
}

export interface ProviderProduct {
  externalId: string;
  name: string;
  durationMinutes: number;
  prices: ProviderPrice[];
}

export interface ProviderSlot {
  /** The departure's id in the operator's system (null for systems keyed by time only). */
  externalId: string | null;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  available: number;
}

export interface HoldRequest {
  productExternalId: string;
  slotExternalId: string | null;
  startsAt: Date;
  seats: number;
  ttlSeconds: number;
}

export interface HoldResult {
  holdId: string;
  expiresAt: Date;
}

export interface ConfirmRequest {
  holdId: string;
  /** Our booking reference, so the operator can find the booking in their system. */
  reference: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  seats: number;
}

export interface AvailabilityProvider {
  readonly kind: string;
  listProducts(): Promise<ProviderProduct[]>;
  getAvailability(productExternalId: string, from: Date, to: Date): Promise<ProviderSlot[]>;
  /** Blocks seats for a few minutes while the customer pays. Throws SoldOutError. */
  hold(request: HoldRequest): Promise<HoldResult>;
  /** Turns a hold into a booking in the operator's system. Returns their booking reference. */
  confirm(request: ConfirmRequest): Promise<{ externalRef: string }>;
  /** Frees the seats of a hold that will not be paid. Idempotent. */
  release(holdId: string): Promise<void>;
  /** Cancels a confirmed booking. Idempotent. */
  cancel(externalRef: string): Promise<void>;
}

export class SoldOutError extends Error {
  constructor(public readonly available: number) {
    super(`not enough seats left (${available} available)`);
    this.name = 'SoldOutError';
  }
}

export class HoldExpiredError extends Error {
  constructor(holdId: string) {
    super(`hold ${holdId} has expired or was released`);
    this.name = 'HoldExpiredError';
  }
}

/** The operator's system failed or answered something we do not understand. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
