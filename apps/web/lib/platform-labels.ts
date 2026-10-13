import type {
  OnboardingStepKey,
  OperatorInviteStatus,
  SubscriptionStatus,
  TenantStatus,
} from '@ap/contracts';
import type { Tone } from '@/components/StatusChip';
import type { Translator } from './i18n';
import type { StatusLabel } from './labels';

/** Labels for the platform owner's screens, operator signup and billing. */

const SUBSCRIPTION_STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  trialing: 'brand',
  active: 'success',
  past_due: 'warning',
  canceled: 'neutral',
};

export const subscriptionStatus = (t: Translator, status: SubscriptionStatus): StatusLabel => ({
  label: t.tk(`labels.subscriptionStatus.${status}`),
  tone: SUBSCRIPTION_STATUS_TONE[status],
});

const TENANT_STATUS_TONE: Record<TenantStatus, Tone> = { active: 'success', suspended: 'danger' };

export const tenantStatus = (t: Translator, status: TenantStatus): StatusLabel => ({
  label: t.tk(`labels.tenantStatus.${status}`),
  tone: TENANT_STATUS_TONE[status],
});

const INVITE_STATUS_TONE: Record<OperatorInviteStatus, Tone> = {
  pending: 'brand',
  accepted: 'success',
  expired: 'neutral',
  revoked: 'neutral',
};

export const inviteStatus = (t: Translator, status: OperatorInviteStatus): StatusLabel => ({
  label: t.tk(`labels.inviteStatus.${status}`),
  tone: INVITE_STATUS_TONE[status],
});

const ONBOARDING_HREF: Record<OnboardingStepKey, string> = {
  product: '/o/products',
  departures: '/o/products',
  commission_plan: '/o/plans',
  affiliate: '/o/affiliates',
  first_booking: '/o/bookings',
};

export const onboardingStep = (
  t: Translator,
  step: OnboardingStepKey,
): { label: string; description: string; href: string; cta: string } => ({
  label: t.tk(`labels.onboarding.${step}.label`),
  description: t.tk(`labels.onboarding.${step}.description`),
  cta: t.tk(`labels.onboarding.${step}.cta`),
  href: ONBOARDING_HREF[step],
});

export const CURRENCIES = ['RON', 'EUR', 'BGN', 'HUF', 'USD', 'GBP'] as const;

/** Whole days from now until `iso` (0 when already past). */
/** New bookings are paused: the unpaid subscription is past its grace period. */
export function salesPaused(pauseAt: string | null, now: Date = new Date()): boolean {
  return pauseAt !== null && new Date(pauseAt).getTime() <= now.getTime();
}

export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}
