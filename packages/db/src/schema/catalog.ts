import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants } from './identity';

/** A trip's texts in one language; what is missing shows in the operator's own language. */
export interface ProductTranslation {
  name?: string;
  description?: string;
  meetingPoint?: string;
  customerNote?: string;
  /** Ticket type labels, by price id. */
  prices?: Record<string, string>;
  /** Booking question labels and choices (same order as the question's options), by question id. */
  questions?: Record<string, { label?: string; options?: string[] }>;
}

export type ProductTranslations = Record<string, ProductTranslation>;

/** A question the operator asks on the booking form ("Children's ages", "Pick-up hotel"). */
export interface BookingQuestion {
  /** Stable id: answers and translations refer to it. */
  id: string;
  label: string;
  /** `text`: free answer. `choice`: one of `options`. */
  kind: 'text' | 'choice';
  required: boolean;
  options: string[];
}

export const availabilityKindEnum = pgEnum('availability_kind', ['internal', 'rest']);

/** How the platform reads and books availability in the operator's own system. */
export const availabilitySources = pgTable('availability_sources', {
  id: id(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  kind: availabilityKindEnum('kind').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  /** Encrypted with the platform key; never returned by the API. */
  credentialsEncrypted: text('credentials_encrypted'),
  active: boolean('active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => availabilitySources.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    meetingPoint: text('meeting_point'),
    images: jsonb('images').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    /** The trip's texts in other languages, by language code (see ProductTranslations). */
    translations: jsonb('translations').$type<ProductTranslations>().notNull().default({}),
    /** The operator's message to every customer of this trip, on the ticket and in the email. */
    customerNote: text('customer_note'),
    /** The operator's own questions on the booking form (BookingQuestion). */
    questions: jsonb('questions').$type<BookingQuestion[]>().notNull().default([]),
    /** Commission every affiliate earns on this trip instead of their plan's rate; null: the plan. */
    commissionRateBps: integer('commission_rate_bps'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('products_tenant_slug').on(t.tenantId, t.slug),
    uniqueIndex('products_tenant_external').on(t.tenantId, t.externalId),
  ],
);

/** Ticket types of a product: adult, child... Prices include VAT. */
export const productPrices = pgTable(
  'product_prices',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    /** How many seats one ticket of this type takes (an infant may take 0). */
    seats: integer('seats').notNull().default(1),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('product_prices_product_code').on(t.productId, t.code)],
);

/**
 * A departure. For the internal calendar this is the source of truth; for external sources it
 * is a short-lived cache, always re-checked with the source when seats are held.
 */
export const slots = pgTable(
  'slots',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    externalId: text('external_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    /** Seats held or booked through this platform. */
    reserved: integer('reserved').notNull().default(0),
    closed: boolean('closed').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('slots_product_start').on(t.productId, t.startsAt),
    index('slots_tenant_start').on(t.tenantId, t.startsAt),
  ],
);

/** Seats blocked for a few minutes while the customer pays. */
export const holds = pgTable(
  'holds',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    slotId: uuid('slot_id')
      .notNull()
      .references(() => slots.id, { onDelete: 'cascade' }),
    seats: integer('seats').notNull(),
    externalHoldId: text('external_hold_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('holds_slot_open').on(t.slotId, t.expiresAt)],
);
