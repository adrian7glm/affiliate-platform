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
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    /** Signed into every session token; raising it signs the person out on every device. */
    sessionVersion: integer('session_version').notNull().default(0),
    /** Two-step login with an authenticator app (TOTP). Secrets are sealed with APP_SECRET. */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /** A secret being set up: shown as a QR code until the first code from the app confirms it. */
    totpPendingSecret: text('totp_pending_secret'),
    /** The last 30-second step a code was accepted for, so a code cannot be used twice. */
    totpLastStep: integer('totp_last_step'),
    /** Hashes of the unused one-time recovery codes. */
    totpRecoveryHashes: jsonb('totp_recovery_hashes').$type<string[]>().notNull().default([]),
    /** Wrong second-step codes in a row, and until when the second step is locked after too many. */
    totpFailedAttempts: integer('totp_failed_attempts').notNull().default(0),
    totpLockedUntil: timestamp('totp_locked_until', { withTimezone: true }),
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
  (t) => [
    uniqueIndex('memberships_user_tenant_role').on(t.userId, t.tenantId, t.role),
    // An operator's team.
    index('memberships_tenant').on(t.tenantId),
  ],
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
