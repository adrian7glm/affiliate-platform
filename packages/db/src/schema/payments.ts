import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { bookings } from './bookings';

export const paymentStatusEnum = pgEnum('payment_status', [
  'requires_payment',
  'succeeded',
  'failed',
  'refunded',
  'partially_refunded',
]);

/** Mirror of the Stripe objects behind a booking, updated from Stripe webhooks. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('stripe'),
    checkoutSessionId: text('checkout_session_id').unique(),
    paymentIntentId: text('payment_intent_id').unique(),
    amountMinor: integer('amount_minor').notNull(),
    refundedMinor: integer('refunded_minor').notNull().default(0),
    currency: text('currency').notNull(),
    status: paymentStatusEnum('status').notNull().default('requires_payment'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payments_booking').on(t.bookingId)],
);

/** Stripe webhook events already processed, so a redelivered event is applied only once. */
export const processedWebhookEvents = pgTable('processed_webhook_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
