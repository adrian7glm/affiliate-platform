import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants, users } from './identity';
import { holds, productPrices, products, slots } from './catalog';
import { affiliateLinks, affiliates } from './affiliates';

export const bookingStatusEnum = pgEnum('booking_status', [
  'pending_payment',
  'confirmed',
  'cancelled',
  'refunded',
  'expired',
]);

/** How the booking reached the operator; drives attribution and reporting. */
export const bookingChannelEnum = pgEnum('booking_channel', [
  'link',
  'qr',
  'affiliate_assisted',
  'promo_code',
  'direct',
]);

export const paymentModeEnum = pgEnum('payment_mode', ['online', 'on_site']);

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Short human reference printed on the ticket, unique per operator. */
    reference: text('reference').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id),
    holdId: uuid('hold_id').references(() => holds.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    status: bookingStatusEnum('status').notNull().default('pending_payment'),
    channel: bookingChannelEnum('channel').notNull(),
    affiliateId: uuid('affiliate_id').references(() => affiliates.id),
    linkId: uuid('link_id').references(() => affiliateLinks.id),
    /** The affiliate's user who made the booking, for assisted bookings. */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    customerName: text('customer_name').notNull(),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    customerLocale: text('customer_locale').notNull().default('en'),
    hotelRoom: text('hotel_room'),
    seats: integer('seats').notNull(),
    currency: text('currency').notNull(),
    totalMinor: integer('total_minor').notNull(),
    taxMinor: integer('tax_minor').notNull().default(0),
    platformFeeMinor: integer('platform_fee_minor').notNull().default(0),
    paymentMode: paymentModeEnum('payment_mode').notNull().default('online'),
    externalRef: text('external_ref'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bookings_tenant_reference').on(t.tenantId, t.reference),
    index('bookings_affiliate_paid').on(t.affiliateId, t.paidAt),
    index('bookings_tenant_starts').on(t.tenantId, t.startsAt),
  ],
);

export const bookingItems = pgTable('booking_items', {
  id: id(),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  priceId: uuid('price_id')
    .notNull()
    .references(() => productPrices.id),
  code: text('code').notNull(),
  label: text('label').notNull(),
  quantity: integer('quantity').notNull(),
  unitAmountMinor: integer('unit_amount_minor').notNull(),
  taxRateBps: integer('tax_rate_bps').notNull(),
});

export const ticketStatusEnum = pgEnum('ticket_status', ['valid', 'checked_in', 'void']);

/** One ticket per booking; its QR code carries a signed token with this id. */
export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    status: ticketStatusEnum('status').notNull().default('valid'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedInByUserId: uuid('checked_in_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tickets_booking').on(t.bookingId)],
);
