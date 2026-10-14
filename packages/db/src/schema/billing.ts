import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants, users } from './identity';

/**
 * What the platform sells to operators: a monthly subscription plus a fee on every booking.
 * Prices are in the platform's own currency, independent of the operator's booking currency.
 */
export const platformPlans = pgTable('platform_plans', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  monthlyPriceMinor: integer('monthly_price_minor').notNull(),
  currency: text('currency').notNull().default('EUR'),
  /** Platform revenue share per booking, in basis points. */
  platformFeeBps: integer('platform_fee_bps').notNull(),
  /** Free trial length for new operators on this plan. */
  trialDays: integer('trial_days').notNull().default(14),
  /** Null means unlimited. */
  maxAffiliates: integer('max_affiliates'),
  /** The Stripe recurring Price this plan maps to, when Stripe Billing is on. */
  stripePriceId: text('stripe_price_id'),
  /** The plan self-signup operators start on. Exactly one active plan should have it. */
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
});

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);

/** One subscription per operator: its plan, billing state and any negotiated fee. */
export const tenantSubscriptions = pgTable('tenant_subscriptions', {
  id: id(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => platformPlans.id),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  /** Negotiated per-booking fee; null means the plan's fee applies. */
  feeBpsOverride: integer('fee_bps_override'),
  /** Negotiated monthly price; null means the plan's price applies. */
  priceMinorOverride: integer('price_minor_override'),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  /** When Stripe first reported a failed payment; new sales pause a grace period later. */
  pastDueSince: timestamp('past_due_since', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** An invitation from the platform owner to a new operator. Only a hash of the token is stored. */
export const operatorInvites = pgTable(
  'operator_invites',
  {
    id: id(),
    email: text('email').notNull(),
    businessName: text('business_name').notNull(),
    planId: uuid('plan_id').references(() => platformPlans.id),
    feeBpsOverride: integer('fee_bps_override'),
    trialDays: integer('trial_days'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('operator_invites_email').on(t.email)],
);
