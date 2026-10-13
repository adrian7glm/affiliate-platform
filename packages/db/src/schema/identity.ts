import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

export const payoutModeEnum = pgEnum('payout_mode', ['manual', 'stripe_connect']);
/** `scanner`: boarding staff who only scan tickets; no access to the operator or affiliate screens. */
export const roleEnum = pgEnum('membership_role', ['owner', 'staff', 'affiliate', 'scanner']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended']);

/** An operator (boat trips, excursions) subscribed to the platform. */
export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('RON'),
  timezone: text('timezone').notNull().default('Europe/Bucharest'),
  defaultLocale: text('default_locale').notNull().default('ro'),
  branding: jsonb('branding')
    .$type<{ logoUrl?: string; primaryColor?: string }>()
    .notNull()
    .default({}),
  /** Platform revenue share per booking, in basis points. */
  platformFeeBps: integer('platform_fee_bps').notNull().default(0),
  attributionWindowDays: integer('attribution_window_days').notNull().default(30),
  payoutMode: payoutModeEnum('payout_mode').notNull().default('manual'),
  allowPayOnSite: boolean('allow_pay_on_site').notNull().default(false),
  /** Hours after departure before an unscanned booking's commission is approved. */
  approvalGraceHours: integer('approval_grace_hours').notNull().default(24),
  stripeAccountId: text('stripe_account_id'),
  /** Shown to customers before they pay and on their ticket. Null: the platform's default text. */
  cancellationPolicy: text('cancellation_policy'),
  /** How customers reach the operator (ticket page, legal pages). */
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  /** Where happy customers leave a review (Google, TripAdvisor); asked the day after the trip. */
  reviewUrl: text('review_url'),
  /** Automatic messages the operator can switch off: departure reminder to customers... */
  remindCustomers: boolean('remind_customers').notNull().default(true),
  /** ...the review request after the trip (needs review_url)... */
  askForReviews: boolean('ask_for_reviews').notNull().default(true),
  /** ..."you made a sale" and "your commission was paid" to affiliates... */
  notifyAffiliates: boolean('notify_affiliates').notNull().default(true),
  /** ...and the monthly report to the owners. */
  monthlyReport: boolean('monthly_report').notNull().default(true),
  /** Suspended operators cannot sign in to their console and their booking pages are offline. */
  status: tenantStatusEnum('status').notNull().default('active'),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
  createdAt: createdAt(),
});

/** One identity per person, across every operator they work with. */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').unique(),
    phone: text('phone').unique(),
    name: text('name'),
    /** Language of the app at the last sign-in: messages to this person are written in it. */
    locale: text('locale'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [check('users_contact_present', sql`${t.email} is not null or ${t.phone} is not null`)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('memberships_user_tenant_role').on(t.userId, t.tenantId, t.role)],
);

/** One-time login codes sent by SMS or email. Only a hash of the code is stored. */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    destination: text('destination').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_destination').on(t.destination, t.createdAt)],
);
