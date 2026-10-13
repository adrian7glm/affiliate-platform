import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants, users } from './identity';
import { commissionPlans } from './commissions';
import { products } from './catalog';

export const affiliateTypeEnum = pgEnum('affiliate_type', ['person', 'organization']);
export const affiliateStatusEnum = pgEnum('affiliate_status', ['invited', 'active', 'suspended']);

/**
 * A seller in an operator's network: a receptionist (person) or a hotel (organization).
 * People who sell on behalf of an organization point to it with parent_affiliate_id.
 */
export const affiliates = pgTable(
  'affiliates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: affiliateTypeEnum('type').notNull().default('person'),
    displayName: text('display_name').notNull(),
    status: affiliateStatusEnum('status').notNull().default('invited'),
    parentAffiliateId: uuid('parent_affiliate_id').references((): AnyPgColumn => affiliates.id),
    /** Null means the operator's default plan. */
    commissionPlanId: uuid('commission_plan_id').references(() => commissionPlans.id),
    /** A negotiated fixed rate that overrides any plan, in basis points. */
    commissionRateBpsOverride: integer('commission_rate_bps_override'),
    inviteToken: text('invite_token').unique(),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    stripeAccountId: text('stripe_account_id'),
    /** The affiliate's own choice: an SMS or email for each sale and each payout. */
    notifySales: boolean('notify_sales').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('affiliates_tenant_user').on(t.tenantId, t.userId),
    index('affiliates_tenant').on(t.tenantId),
  ],
);

/** A short link (and the QR code drawn from it). An affiliate can have many. */
export const affiliateLinks = pgTable(
  'affiliate_links',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    affiliateId: uuid('affiliate_id')
      .notNull()
      .references(() => affiliates.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    /** When set, the link opens this product directly. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    label: text('label'),
    campaign: text('campaign'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('affiliate_links_affiliate').on(t.affiliateId)],
);

export const clicks = pgTable(
  'clicks',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => affiliateLinks.id, { onDelete: 'cascade' }),
    affiliateId: uuid('affiliate_id').notNull(),
    visitorId: text('visitor_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    referrer: text('referrer'),
    /** Repeat clicks from the same visitor within a short window are kept but not counted. */
    counted: boolean('counted').notNull().default(true),
  },
  (t) => [
    index('clicks_link_time').on(t.linkId, t.occurredAt),
    index('clicks_visitor_time').on(t.visitorId, t.occurredAt),
  ],
);
