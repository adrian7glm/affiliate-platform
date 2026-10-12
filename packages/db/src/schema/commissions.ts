import { sql } from 'drizzle-orm';
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
import { affiliates } from './affiliates';
import { bookings } from './bookings';

export const planKindEnum = pgEnum('commission_plan_kind', ['fixed', 'tiered']);
export const tierModeEnum = pgEnum('commission_tier_mode', ['marginal', 'retroactive']);
export const basisEnum = pgEnum('commission_basis', ['gross', 'net_of_tax']);

/**
 * Commission rules of an operator. Plans are not edited once they have been used: changing the
 * rules creates a new plan, so past commissions stay explainable.
 */
export const commissionPlans = pgTable(
  'commission_plans',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: planKindEnum('kind').notNull(),
    mode: tierModeEnum('mode'),
    rateBps: integer('rate_bps'),
    tiers: jsonb('tiers').$type<{ fromSale: number; rateBps: number }[]>(),
    basis: basisEnum('basis').notNull().default('gross'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('commission_plans_tenant').on(t.tenantId)],
);

export const entryKindEnum = pgEnum('commission_entry_kind', ['sale', 'adjustment', 'reversal']);
export const entryStatusEnum = pgEnum('commission_entry_status', ['pending', 'approved', 'paid']);

export const payoutStatusEnum = pgEnum('payout_status', ['draft', 'approved', 'paid', 'failed']);
export const payoutMethodEnum = pgEnum('payout_method', ['manual', 'stripe_connect']);

/** A monthly payment to one affiliate. */
export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => affiliates.id),
    periodKey: text('period_key').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: payoutStatusEnum('status').notNull().default('draft'),
    method: payoutMethodEnum('method').notNull(),
    stripeTransferId: text('stripe_transfer_id'),
    note: text('note'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payouts_affiliate_period').on(t.tenantId, t.affiliateId, t.periodKey)],
);

/**
 * Append-only commission ledger. A database trigger (see migrations) rejects deletes and any
 * update other than moving an entry through pending -> approved -> paid.
 */
export const commissionEntries = pgTable(
  'commission_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => affiliates.id),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    periodKey: text('period_key').notNull(),
    kind: entryKindEnum('kind').notNull(),
    status: entryStatusEnum('status').notNull().default('pending'),
    amountMinor: integer('amount_minor').notNull(),
    rateBps: integer('rate_bps').notNull(),
    baseMinor: integer('base_minor').notNull(),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    /** The rules used, frozen at the time of the entry. */
    planSnapshot: jsonb('plan_snapshot').notNull(),
    payoutId: uuid('payout_id').references(() => payouts.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('commission_entries_affiliate_period').on(t.affiliateId, t.periodKey),
    index('commission_entries_booking').on(t.bookingId),
    // At most one `sale` entry per booking, even if a webhook is delivered twice.
    uniqueIndex('commission_entries_one_sale_per_booking')
      .on(t.bookingId)
      .where(sql`kind = 'sale'`),
  ],
);
