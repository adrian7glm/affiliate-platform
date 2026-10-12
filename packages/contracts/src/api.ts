import { z } from 'zod';

/**
 * HTTP API contract shared by the API (which validates requests with these schemas) and the
 * web app (which uses the inferred types). Money is always integer minor units + currency.
 */

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

export const localeSchema = z.enum(['ro', 'en', 'de', 'fr', 'it']);
export type Locale = z.infer<typeof localeSchema>;

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'phone must be in international format, e.g. +40722123456');
const email = z.string().trim().toLowerCase().email();

/** A login destination: a phone number (SMS) or an email address. */
export const destinationSchema = z.union([phone, email]);

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

export const requestOtpBody = z.object({ destination: destinationSchema });
export type RequestOtpBody = z.infer<typeof requestOtpBody>;

export const verifyOtpBody = z.object({
  destination: destinationSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'the code has 6 digits'),
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBody>;

export type Role = 'owner' | 'staff' | 'affiliate';

export interface MembershipDto {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: Role;
  affiliateId: string | null;
}

export interface MeDto {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    isPlatformAdmin: boolean;
  };
  memberships: MembershipDto[];
}

export interface SessionDto extends MeDto {
  token: string;
}

export const acceptInviteBody = z.object({
  token: z.string().min(16),
  name: z.string().trim().min(1).max(120).optional(),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBody>;

export interface InvitePreviewDto {
  tenantName: string;
  affiliateName: string;
  expired: boolean;
}

// ---------------------------------------------------------------------------------------------
// Commission plans
// ---------------------------------------------------------------------------------------------

const rateBps = z.number().int().min(0).max(10_000);

export const tierSchema = z.object({ fromSale: z.number().int().min(1), rateBps });

export const createPlanBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fixed'),
    name: z.string().trim().min(1).max(80),
    rateBps,
    basis: z.enum(['gross', 'net_of_tax']).default('gross'),
    isDefault: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('tiered'),
    name: z.string().trim().min(1).max(80),
    mode: z.enum(['marginal', 'retroactive']).default('marginal'),
    tiers: z.array(tierSchema).min(1).max(20),
    basis: z.enum(['gross', 'net_of_tax']).default('gross'),
    isDefault: z.boolean().default(false),
  }),
]);
export type CreatePlanBody = z.infer<typeof createPlanBody>;

/**
 * New rules for an existing plan. The old version is archived and its affiliates move to the new
 * one, so commissions already recorded keep the rules they were computed with.
 */
export const updatePlanBody = createPlanBody;
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;

export interface ArchivePlanResultDto {
  /** Affiliates that were on the archived plan and now use the default plan. */
  affiliatesMoved: number;
}

export interface CommissionPlanDto {
  id: string;
  name: string;
  kind: 'fixed' | 'tiered';
  mode: 'marginal' | 'retroactive' | null;
  rateBps: number | null;
  tiers: { fromSale: number; rateBps: number }[] | null;
  basis: 'gross' | 'net_of_tax';
  isDefault: boolean;
  /** Affiliates assigned to this plan explicitly (the default plan also covers the unassigned). */
  affiliateCount: number;
}

// ---------------------------------------------------------------------------------------------
// Affiliates (operator side)
// ---------------------------------------------------------------------------------------------

export const inviteAffiliateBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  type: z.enum(['person', 'organization']).default('person'),
  destination: destinationSchema.optional(),
  commissionPlanId: z.string().uuid().nullable().optional(),
  commissionRateBpsOverride: rateBps.nullable().optional(),
  parentAffiliateId: z.string().uuid().nullable().optional(),
});
export type InviteAffiliateBody = z.infer<typeof inviteAffiliateBody>;

export const updateAffiliateBody = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  commissionPlanId: z.string().uuid().nullable().optional(),
  commissionRateBpsOverride: rateBps.nullable().optional(),
});
export type UpdateAffiliateBody = z.infer<typeof updateAffiliateBody>;

export interface AffiliateDto {
  id: string;
  displayName: string;
  type: 'person' | 'organization';
  status: 'invited' | 'active' | 'suspended';
  commissionPlanId: string | null;
  commissionRateBpsOverride: number | null;
  parentAffiliateId: string | null;
  inviteUrl: string | null;
  createdAt: string;
}

export interface AffiliateWithStatsDto extends AffiliateDto {
  month: { periodKey: string; paidSales: number; earnedMinor: number; currency: string };
}

// ---------------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------------

const productSlug = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and dashes')
  .max(80);
const durationMinutes = z
  .number()
  .int()
  .min(5)
  .max(24 * 60);
const priceCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/)
  .max(40);
const priceFields = {
  label: z.string().trim().min(1).max(80),
  amountMinor: z.number().int().min(0),
  taxRateBps: rateBps.default(0),
  seats: z.number().int().min(0).max(10).default(1),
};

export const createProductBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: productSlug,
  description: z.string().trim().max(4000).optional(),
  durationMinutes,
  meetingPoint: z.string().trim().max(400).optional(),
  prices: z
    .array(z.object({ code: priceCodeSchema, ...priceFields }))
    .min(1)
    .max(20),
});
export type CreateProductBody = z.infer<typeof createProductBody>;

/**
 * Changes to a trip. `prices` replaces the whole price list: entries with an `id` update that
 * ticket type, entries without one are added, and ticket types left out stop being sold (they
 * stay on past bookings). Trips from the operator's own system only accept `active`.
 */
export const updateProductBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: productSlug.optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  durationMinutes: durationMinutes.optional(),
  meetingPoint: z.string().trim().max(400).nullable().optional(),
  /** False hides the trip from the booking page and from affiliates. */
  active: z.boolean().optional(),
  prices: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        code: priceCodeSchema.optional(),
        ...priceFields,
      }),
    )
    .min(1)
    .max(20)
    .optional(),
});
export type UpdateProductBody = z.infer<typeof updateProductBody>;

export interface PriceDto {
  id: string;
  code: string;
  label: string;
  amountMinor: number;
  taxRateBps: number;
  seats: number;
}

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  meetingPoint: string | null;
  images: string[];
  currency: string;
  prices: PriceDto[];
  /** Lowest adult-like price, for listings. */
  fromMinor: number;
  /** True when prices and departures come from the operator's own system (not editable here). */
  managedExternally: boolean;
  /** False when the operator has paused sales of this trip (only operators see inactive trips). */
  active: boolean;
}

/** Generates departures for a date range: every day in range, at each local time. */
export const createSlotsBody = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  times: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
    .min(1)
    .max(48),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5, 6, 7]),
  capacity: z.number().int().min(1).max(10_000),
});
export type CreateSlotsBody = z.infer<typeof createSlotsBody>;

export interface SlotDto {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  available: number;
}

/** A departure as the operator sees it: also closed ones, with seats already taken. */
export interface OperatorSlotDto extends SlotDto {
  reserved: number;
  closed: boolean;
}

/**
 * Changes several departures of one trip at once (one departure, or a whole day when the weather
 * turns). Capacity can't go below the seats already taken.
 */
export const updateSlotsBody = z
  .object({
    slotIds: z.array(z.string().uuid()).min(1).max(500),
    closed: z.boolean().optional(),
    capacity: z.number().int().min(1).max(10_000).optional(),
  })
  .refine((b) => b.closed !== undefined || b.capacity !== undefined, {
    message: 'nothing to change',
  });
export type UpdateSlotsBody = z.infer<typeof updateSlotsBody>;

export const deleteSlotsBody = z.object({ slotIds: z.array(z.string().uuid()).min(1).max(500) });
export type DeleteSlotsBody = z.infer<typeof deleteSlotsBody>;

export interface UpdateSlotsResultDto {
  slots: OperatorSlotDto[];
  /** Departures whose capacity was raised to the seats already taken instead of the asked value. */
  capacityRaised: number;
}

export interface DeleteSlotsResultDto {
  deleted: number;
  /** Departures that have bookings: they were closed to new sales instead of deleted. */
  closedInstead: number;
}

// ---------------------------------------------------------------------------------------------
// Availability sources (the operator's own booking system)
// ---------------------------------------------------------------------------------------------

export const connectSourceBody = z.object({
  name: z.string().trim().min(1).max(80),
  /** Base URL of the operator's API implementing docs/rest-adapter.md. */
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((url) => /^https?:\/\//.test(url), 'use an http(s) address'),
  token: z.string().trim().min(1).max(500),
});
export type ConnectSourceBody = z.infer<typeof connectSourceBody>;

export interface SourceDto {
  id: string;
  kind: 'internal' | 'rest';
  name: string;
  baseUrl: string | null;
  active: boolean;
  lastSyncedAt: string | null;
  productCount: number;
}

export interface SyncResultDto {
  products: number;
  slots: number;
}

// ---------------------------------------------------------------------------------------------
// Links and QR codes
// ---------------------------------------------------------------------------------------------

export const createLinkBody = z.object({
  productId: z.string().uuid().nullable().optional(),
  label: z.string().trim().max(80).optional(),
  campaign: z.string().trim().max(80).optional(),
});
export type CreateLinkBody = z.infer<typeof createLinkBody>;

export interface LinkDto {
  id: string;
  code: string;
  url: string;
  /** Same link marked as a QR scan (`?s=qr`); encode this one in QR codes. */
  qrUrl: string;
  label: string | null;
  campaign: string | null;
  productId: string | null;
  productName: string | null;
  active: boolean;
  clicks: number;
  sales: number;
}

export const recordClickBody = z.object({
  visitorId: z.string().min(8).max(64),
  userAgent: z.string().max(400).optional(),
  referrer: z.string().max(400).optional(),
});
export type RecordClickBody = z.infer<typeof recordClickBody>;

export interface ClickResultDto {
  tenantSlug: string;
  productSlug: string | null;
  /** How long the attribution cookie should live. */
  attributionWindowDays: number;
}

// ---------------------------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------------------------

export const customerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: email.optional(),
    phone: phone.optional(),
    locale: localeSchema.default('en'),
    hotelRoom: z.string().trim().max(20).optional(),
  })
  .refine((c) => c.email || c.phone, { message: 'an email or a phone number is required' });

export const bookingItemsSchema = z
  .array(z.object({ priceId: z.string().uuid(), quantity: z.number().int().min(1).max(50) }))
  .min(1)
  .max(10);

/** Customer booking from the public page (after scanning a QR code or opening a link). */
export const publicCheckoutBody = z.object({
  slotId: z.string().uuid(),
  items: bookingItemsSchema,
  customer: customerSchema,
  /** The affiliate link code from the attribution cookie, if any. */
  ref: z.string().max(32).optional(),
  /** Whether the customer arrived by scanning the QR code (`/r/CODE?s=qr`) or opening the link. */
  refSource: z.enum(['qr', 'link']).optional(),
  visitorId: z.string().max(64).optional(),
});
export type PublicCheckoutBody = z.infer<typeof publicCheckoutBody>;

/** Instant booking made by an affiliate on behalf of a customer. */
export const assistedBookingBody = z.object({
  slotId: z.string().uuid(),
  items: bookingItemsSchema,
  customer: customerSchema,
  /**
   * - `link`: the customer pays online (QR on the affiliate's screen, or a link by SMS/email).
   * - `on_site`: the customer pays when boarding (only if the operator allows it).
   */
  payment: z.enum(['link', 'on_site']).default('link'),
});
export type AssistedBookingBody = z.infer<typeof assistedBookingBody>;

export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'refunded' | 'expired';
export type BookingChannel = 'link' | 'qr' | 'affiliate_assisted' | 'promo_code' | 'direct';

export interface BookingDto {
  id: string;
  reference: string;
  status: BookingStatus;
  channel: BookingChannel;
  productName: string;
  startsAt: string;
  seats: number;
  customerName: string;
  totalMinor: number;
  currency: string;
  paymentMode: 'online' | 'on_site';
  affiliateName: string | null;
  createdAt: string;
  paidAt: string | null;
  /** The booking's reference in the operator's own system, once it is confirmed there. */
  externalRef: string | null;
}

export interface CheckoutResultDto {
  booking: BookingDto;
  /** Where the customer pays. Null for pay-on-site bookings. */
  paymentUrl: string | null;
  /** Public ticket page; becomes valid once the booking is confirmed. */
  ticketUrl: string;
}

export interface TicketDto {
  bookingReference: string;
  status: 'valid' | 'checked_in' | 'void' | 'pending_payment';
  productName: string;
  tenantName: string;
  startsAt: string;
  meetingPoint: string | null;
  seats: number;
  items: { label: string; quantity: number }[];
  customerName: string;
  /** Signed token encoded in the QR code; null until the booking is confirmed. */
  qrToken: string | null;
  paymentMode: 'online' | 'on_site';
  amountDueOnSiteMinor: number;
  currency: string;
  /** The operator's timezone: departure times are shown in it. */
  timezone: string;
  branding: BrandingDto;
}

export const checkInBody = z.object({ token: z.string().min(16).max(2000) });
export type CheckInBody = z.infer<typeof checkInBody>;

export interface CheckInResultDto {
  result: 'checked_in' | 'already_checked_in' | 'not_valid';
  message: string;
  ticket: TicketDto | null;
  /** Money to take from the customer now: a pay-at-boarding booking checked in by this scan. */
  collectMinor: number;
}

export const cancelBookingBody = z.object({ reason: z.string().trim().min(1).max(400) });
export type CancelBookingBody = z.infer<typeof cancelBookingBody>;

// ---------------------------------------------------------------------------------------------
// Affiliate home and earnings
// ---------------------------------------------------------------------------------------------

export interface TierProgressDto {
  paidSales: number;
  tierIndex: number;
  tierCount: number;
  currentRateBps: number;
  nextSaleRateBps: number;
  nextRateBps: number | null;
  salesToNextTier: number | null;
}

export interface AffiliateHomeDto {
  affiliate: { id: string; displayName: string; status: string };
  tenant: {
    id: string;
    slug: string;
    name: string;
    currency: string;
    timezone: string;
    allowPayOnSite: boolean;
  };
  periodKey: string;
  earnings: {
    /** Earned this month, still waiting for the trip to happen. */
    pendingMinor: number;
    /** Earned this month and approved for payout. */
    approvedMinor: number;
    monthTotalMinor: number;
    /** Approved and not yet paid, across all months. */
    payableMinor: number;
  };
  progress: TierProgressDto;
  plan: {
    kind: 'fixed' | 'tiered';
    mode: 'marginal' | 'retroactive' | null;
    tiers: { fromSale: number; rateBps: number }[];
  };
  primaryLink: LinkDto;
  recentBookings: BookingDto[];
}

export interface CommissionEntryDto {
  id: string;
  bookingReference: string;
  productName: string;
  kind: 'sale' | 'adjustment' | 'reversal';
  status: 'pending' | 'approved' | 'paid';
  amountMinor: number;
  rateBps: number;
  baseMinor: number;
  reason: string;
  createdAt: string;
}

export interface EarningsDto {
  periodKey: string;
  currency: string;
  totalMinor: number;
  entries: CommissionEntryDto[];
}

// ---------------------------------------------------------------------------------------------
// Operator reports and payouts
// ---------------------------------------------------------------------------------------------

export interface CommissionReportRowDto {
  affiliateId: string;
  affiliateName: string;
  paidSales: number;
  salesMinor: number;
  pendingMinor: number;
  approvedMinor: number;
  paidMinor: number;
  totalMinor: number;
}

export interface CommissionReportDto {
  periodKey: string;
  currency: string;
  rows: CommissionReportRowDto[];
  totals: Omit<CommissionReportRowDto, 'affiliateId' | 'affiliateName'>;
}

export const closePeriodBody = z.object({ periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type ClosePeriodBody = z.infer<typeof closePeriodBody>;

export interface PayoutDto {
  id: string;
  affiliateId: string;
  affiliateName: string;
  periodKey: string;
  amountMinor: number;
  currency: string;
  status: 'draft' | 'approved' | 'paid' | 'failed';
  method: 'manual' | 'stripe_connect';
  paidAt: string | null;
}

export interface ClosePeriodResultDto {
  periodKey: string;
  adjustmentsCreated: number;
  entriesApproved: number;
  payouts: PayoutDto[];
}

export interface OperatorDashboardDto {
  tenant: { id: string; slug: string; name: string; currency: string; timezone: string };
  periodKey: string;
  bookings: { count: number; revenueMinor: number };
  commissions: { totalMinor: number };
  affiliates: { active: number; invited: number };
  topAffiliates: { affiliateId: string; name: string; paidSales: number; salesMinor: number }[];
}

// ---------------------------------------------------------------------------------------------
// Operator settings
// ---------------------------------------------------------------------------------------------

/** The operator's look on the booking page and tickets. */
export interface BrandingDto {
  /** An https address or a small inline image (data:image/png|jpeg|webp;base64,...). */
  logoUrl?: string;
  /** #rrggbb */
  primaryColor?: string;
}

/** Inline logos are resized in the browser before upload; this keeps requests small. */
export const MAX_INLINE_LOGO_CHARS = 90_000;

export const logoUrlSchema = z
  .string()
  .trim()
  .max(MAX_INLINE_LOGO_CHARS, 'the logo is too large')
  .refine(
    (v) =>
      /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(v) ||
      (/^https:\/\/[^\s"'<>]+$/.test(v) && v.length <= 2000),
    'use an https address or a png, jpeg or webp image',
  );

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a color like #0369a1')
  .transform((v) => v.toLowerCase());

export const updateSettingsBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** Null removes the logo. */
  logoUrl: logoUrlSchema.nullable().optional(),
  /** Null goes back to the platform color. */
  primaryColor: hexColorSchema.nullable().optional(),
  /** Whether affiliates may book with payment at boarding. */
  allowPayOnSite: z.boolean().optional(),
  /** How long after a click a booking still counts for the affiliate. */
  attributionWindowDays: z.number().int().min(1).max(365).optional(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsBody>;

export interface OperatorSettingsDto {
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  branding: BrandingDto;
  allowPayOnSite: boolean;
  attributionWindowDays: number;
  /** Only owners change settings; staff see them read-only. */
  canEdit: boolean;
}

// ---------------------------------------------------------------------------------------------
// Public pages
// ---------------------------------------------------------------------------------------------

export interface PublicTenantDto {
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  branding: BrandingDto;
  products: ProductDto[];
}
