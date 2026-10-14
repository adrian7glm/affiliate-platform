import { z } from 'zod';

/**
 * Contract for the platform owner's side: plans and fees sold to operators, operator
 * onboarding (self-signup or invitation), operator billing and the super-admin area.
 * Money is integer minor units + currency, fees are basis points (300 = 3%).
 */

const bps = z.number().int().min(0).max(5_000);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM');
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency is a 3-letter code, e.g. RON');
const email = z.string().trim().toLowerCase().email();

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, 'use 3-48 lowercase letters, digits and dashes');

export type TenantStatus = 'active' | 'suspended';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

export interface PlatformPlanDto {
  id: string;
  code: string;
  name: string;
  description: string;
  monthlyPriceMinor: number;
  currency: string;
  platformFeeBps: number;
  trialDays: number;
  maxAffiliates: number | null;
  stripePriceId: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Operators currently subscribed to this plan. */
  tenantCount: number;
}

export const createPlatformPlanBody = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,32}$/, 'use 2-32 lowercase letters, digits and dashes'),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  monthlyPriceMinor: z.number().int().min(0).max(10_000_000),
  currency: currency.default('EUR'),
  platformFeeBps: bps,
  trialDays: z.number().int().min(0).max(365).default(14),
  maxAffiliates: z.number().int().min(1).max(100_000).nullable().default(null),
  stripePriceId: z.string().trim().min(3).max(120).nullable().default(null),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreatePlatformPlanBody = z.infer<typeof createPlatformPlanBody>;

export const updatePlatformPlanBody = createPlatformPlanBody
  .omit({ code: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdatePlatformPlanBody = z.infer<typeof updatePlatformPlanBody>;

// ---------------------------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------------------------

export interface SubscriptionDto {
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** What the operator pays per month (negotiated price or the plan's). */
  monthlyPriceMinor: number;
  currency: string;
  /** Fee per booking actually applied (negotiated or the plan's). */
  platformFeeBps: number;
  feeBpsOverride: number | null;
  priceMinorOverride: number | null;
  maxAffiliates: number | null;
  /** True when Stripe Billing manages this subscription. */
  billedByStripe: boolean;
  /**
   * When new bookings pause (or paused) because the subscription is unpaid: the trial end or
   * failed payment plus the grace period. Null while nothing is owed.
   */
  salesPauseAt: string | null;
}

// ---------------------------------------------------------------------------------------------
// Super-admin: operators
// ---------------------------------------------------------------------------------------------

export interface AdminTenantRowDto {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  currency: string;
  createdAt: string;
  ownerEmail: string | null;
  subscription: SubscriptionDto | null;
  affiliates: number;
  /** In the requested period, in the operator's currency. */
  bookings: number;
  grossMinor: number;
  platformFeesMinor: number;
  /** Most recent booking ever made, to spot operators that went quiet. */
  lastBookingAt: string | null;
}

export interface AdminOverviewDto {
  period: string;
  operators: {
    total: number;
    active: number;
    trialing: number;
    suspended: number;
    pastDue: number;
  };
  /** Monthly recurring revenue of paying subscriptions, per plan currency. */
  mrr: { amountMinor: number; currency: string }[];
  /** Per booking currency, for the period. */
  volume: { currency: string; bookings: number; grossMinor: number; platformFeesMinor: number }[];
  newOperators: number;
  tenants: AdminTenantRowDto[];
}

export const adminOverviewQuery = z.object({ period: period.optional() });
export type AdminOverviewQuery = z.infer<typeof adminOverviewQuery>;

export interface AdminAuditEntryDto {
  id: string;
  action: string;
  actor: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AdminTenantDetailDto extends AdminTenantRowDto {
  timezone: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  stripeAccountConnected: boolean;
  owners: { userId: string; name: string | null; email: string | null; phone: string | null }[];
  products: number;
  /** Last six months, oldest first, in the operator's currency. */
  months: { period: string; bookings: number; grossMinor: number; platformFeesMinor: number }[];
  setup: OnboardingDto;
  audit: AdminAuditEntryDto[];
}

export const updateTenantStatusBody = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active') }),
  z.object({ status: z.literal('suspended'), reason: z.string().trim().min(3).max(300) }),
]);
export type UpdateTenantStatusBody = z.infer<typeof updateTenantStatusBody>;

export const updateTenantBillingBody = z
  .object({
    planId: z.string().uuid().optional(),
    feeBpsOverride: bps.nullable().optional(),
    priceMinorOverride: z.number().int().min(0).max(10_000_000).nullable().optional(),
    /** Extends (or shortens) the free trial; only for subscriptions still trialing. */
    trialEndsAt: z.string().datetime().optional(),
    /**
     * Manual billing: record that the operator paid until this date (subscription becomes
     * active). Not allowed when Stripe manages the subscription.
     */
    paidUntil: z.string().datetime().optional(),
    /** Ends the subscription; the operator keeps working until suspended. */
    cancel: z.literal(true).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateTenantBillingBody = z.infer<typeof updateTenantBillingBody>;

// ---------------------------------------------------------------------------------------------
// Operator invitations and self-signup
// ---------------------------------------------------------------------------------------------

export const createOperatorInviteBody = z.object({
  email,
  businessName: z.string().trim().min(2).max(120),
  planId: z.string().uuid().nullable().default(null),
  feeBpsOverride: bps.nullable().default(null),
  trialDays: z.number().int().min(0).max(365).nullable().default(null),
});
export type CreateOperatorInviteBody = z.infer<typeof createOperatorInviteBody>;

export type OperatorInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface OperatorInviteDto {
  id: string;
  email: string;
  businessName: string;
  planName: string | null;
  feeBpsOverride: number | null;
  trialDays: number | null;
  status: OperatorInviteStatus;
  expiresAt: string;
  createdAt: string;
  tenantId: string | null;
  /** Only returned right after creation: the token is not stored in clear. */
  inviteUrl: string | null;
}

export interface OperatorInvitePreviewDto {
  email: string;
  businessName: string;
  plan: Pick<
    PlatformPlanDto,
    'name' | 'monthlyPriceMinor' | 'currency' | 'platformFeeBps' | 'maxAffiliates'
  > | null;
  trialDays: number;
  platformFeeBps: number;
  status: OperatorInviteStatus;
}

export interface SignupOptionsDto {
  /** False when the platform only accepts operators by invitation. */
  selfSignup: boolean;
  plans: Pick<
    PlatformPlanDto,
    | 'id'
    | 'code'
    | 'name'
    | 'description'
    | 'monthlyPriceMinor'
    | 'currency'
    | 'platformFeeBps'
    | 'trialDays'
    | 'maxAffiliates'
    | 'isDefault'
  >[];
}

export const createTenantBody = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slug.optional(),
  currency: currency.default('RON'),
  timezone: z.string().trim().min(3).max(64).default('Europe/Bucharest'),
  ownerName: z.string().trim().min(1).max(120).optional(),
  planId: z.string().uuid().optional(),
  inviteToken: z.string().min(16).optional(),
});
export type CreateTenantBody = z.infer<typeof createTenantBody>;

export interface CreateTenantResultDto {
  tenantId: string;
  slug: string;
}

export interface SlugCheckDto {
  slug: string;
  available: boolean;
  suggestion: string;
}

// ---------------------------------------------------------------------------------------------
// Operator: guided setup and billing
// ---------------------------------------------------------------------------------------------

export type OnboardingStepKey =
  'product' | 'departures' | 'commission_plan' | 'affiliate' | 'first_booking';

export interface OnboardingDto {
  steps: { key: OnboardingStepKey; done: boolean }[];
  completed: number;
  total: number;
}

export interface OperatorBillingDto {
  subscription: SubscriptionDto | null;
  plans: SignupOptionsDto['plans'];
  /** 'stripe' when cards are charged through Stripe Billing, 'manual' when invoiced by hand. */
  provider: 'stripe' | 'manual';
  /** Platform fees on this month's paid bookings, in the operator's currency. */
  feesThisMonth: { amountMinor: number; currency: string; bookings: number };
}

export const startSubscriptionBody = z.object({ planId: z.string().uuid().optional() });
export type StartSubscriptionBody = z.infer<typeof startSubscriptionBody>;

export interface BillingRedirectDto {
  /** Where to send the browser: Stripe Checkout / Customer Portal, or back to the app. */
  url: string;
}

// ---------------------------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------------------------

export interface PlatformSettingsDto {
  /** People can ask for a sign-in code by SMS. */
  smsLogin: boolean;
  /** An SMS provider is configured (SMS_PROVIDER is not disabled). */
  smsAvailable: boolean;
  /** "Sign in with Google" is configured on the server. */
  googleLogin: boolean;
  /** Demo accounts are shown on the sign-in page (DEMO_MODE). */
  demoMode: boolean;
}

export const updatePlatformSettingsBody = z.object({
  smsLogin: z.boolean().optional(),
});
export type UpdatePlatformSettingsBody = z.infer<typeof updatePlatformSettingsBody>;

// ---------------------------------------------------------------------------------------------
// Admin: system health
// ---------------------------------------------------------------------------------------------

export interface WorkerJobDto {
  job: string;
  /** How often the job is meant to run. */
  everySeconds: number;
  lastRunAt: string | null;
  lastError: string | null;
  /** Not run for more than three of its intervals: the worker is probably down. */
  stale: boolean;
}

/** An internal event (e.g. "booking paid → record the commission") that stopped being retried. */
export interface DeadEventDto {
  id: number;
  type: string;
  tenantId: string | null;
  tenantName: string | null;
  attempts: number;
  lastError: string | null;
  occurredAt: string;
}

export interface AdminSystemDto {
  worker: { status: 'ok' | 'stale' | 'unknown'; jobs: WorkerJobDto[] };
  deadEvents: DeadEventDto[];
}
