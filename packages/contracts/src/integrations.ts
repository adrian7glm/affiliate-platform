import { z } from 'zod';

/**
 * Integrations with other software: webhooks (the platform calls the operator's address when
 * something happens) and the departures calendar feed. The webhook payload is a public contract:
 * add fields freely, never rename or remove one. Documented in docs/webhooks.md.
 */

/** What other software can be told about. */
export const WEBHOOK_EVENT_TYPES = [
  /** Seats are taken for good: paid online, or booked to be paid at boarding. */
  'booking.confirmed',
  /** The money arrived: online payment, or cash/card collected at boarding. */
  'booking.paid',
  /** A confirmed booking was cancelled (by the operator, or with its departure). */
  'booking.cancelled',
  /** The ticket was scanned at boarding. */
  'ticket.checked_in',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Sent only by "Send a test", so the receiving side can be set up before a real booking. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export const MAX_WEBHOOK_ENDPOINTS = 10;

const webhookUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((url) => /^https?:\/\//i.test(url), 'use an http(s) address');

const webhookEvents = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .max(WEBHOOK_EVENT_TYPES.length)
  .transform((list) => [...new Set(list)]);

export const createWebhookBody = z.object({
  url: webhookUrl,
  description: z.string().trim().max(120).nullable().optional(),
  /** Empty or missing: every event type. */
  events: webhookEvents.optional(),
});
export type CreateWebhookBody = z.infer<typeof createWebhookBody>;

export const updateWebhookBody = z.object({
  url: webhookUrl.optional(),
  description: z.string().trim().max(120).nullable().optional(),
  events: webhookEvents.optional(),
  active: z.boolean().optional(),
});
export type UpdateWebhookBody = z.infer<typeof updateWebhookBody>;

export interface WebhookEndpointDto {
  id: string;
  url: string;
  description: string | null;
  /** Empty: every event type. */
  events: WebhookEventType[];
  active: boolean;
  lastAttemptAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  createdAt: string;
  /** Events waiting to be sent or retried. */
  pending: number;
  /** Events given up on after every retry; can be sent again by hand. */
  failed: number;
}

/** Returned once, when the address is added: the secret is needed to check signatures. */
export interface CreatedWebhookDto {
  endpoint: WebhookEndpointDto;
  secret: string;
}

export interface WebhookSecretDto {
  secret: string;
}

export interface WebhookDeliveryDto {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'sending' | 'delivered' | 'failed';
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

export interface WebhookTestResultDto {
  ok: boolean;
  /** HTTP status the address answered with; null when it could not be reached. */
  status: number | null;
  error: string | null;
  durationMs: number;
}

export interface CalendarFeedDto {
  /** Secret part of the calendar address: /public/calendar/{token}.ics on the API. */
  token: string;
}

// -----------------------------------------------------------------------------------------------
// The body every webhook request carries
// -----------------------------------------------------------------------------------------------

export interface WebhookBookingPayload {
  id: string;
  reference: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded' | 'expired';
  channel: 'link' | 'qr' | 'affiliate_assisted' | 'promo_code' | 'direct';
  paymentMode: 'online' | 'on_site';
  paid: boolean;
  paidAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  trip: { id: string; name: string };
  startsAt: string;
  endsAt: string;
  seats: number;
  items: {
    code: string;
    label: string;
    quantity: number;
    /** Decimal string in the booking's currency, e.g. "120.00". */
    unitAmount: string;
    unitAmountMinor: number;
  }[];
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    language: string;
    hotelRoom: string | null;
  };
  currency: string;
  total: string;
  totalMinor: number;
  tax: string;
  taxMinor: number;
  affiliate: { id: string; name: string } | null;
  /** The booking's reference in the operator's own booking system, when connected. */
  externalRef: string | null;
}

export interface WebhookPayload {
  /** Unique per event; the same on every retry, so receivers can ignore repeats. */
  id: string;
  type: WebhookEventType | typeof WEBHOOK_TEST_EVENT;
  createdAt: string;
  operator: { id: string; slug: string; name: string };
  data: {
    booking: WebhookBookingPayload;
    /** booking.cancelled only. */
    cancellation?: { reason: string; refunded: boolean };
    /** ticket.checked_in only. */
    checkIn?: { ticketId: string; checkedInAt: string };
  };
}
