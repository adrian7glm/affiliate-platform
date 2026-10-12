import type {
  OnboardingStepKey,
  OperatorInviteStatus,
  SubscriptionStatus,
  TenantStatus,
} from '@ap/contracts';
import type { Tone } from '@/components/StatusChip';

/** Romanian labels for the platform owner's screens, operator signup and billing. */

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: Tone }> = {
  trialing: { label: 'Perioadă de probă', tone: 'brand' },
  active: { label: 'Plătește', tone: 'success' },
  past_due: { label: 'Restanță', tone: 'warning' },
  canceled: { label: 'Abonament oprit', tone: 'neutral' },
};

export const TENANT_STATUS: Record<TenantStatus, { label: string; tone: Tone }> = {
  active: { label: 'Activ', tone: 'success' },
  suspended: { label: 'Suspendat', tone: 'danger' },
};

export const INVITE_STATUS: Record<OperatorInviteStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Trimisă', tone: 'brand' },
  accepted: { label: 'Cont deschis', tone: 'success' },
  expired: { label: 'Expirată', tone: 'neutral' },
  revoked: { label: 'Anulată', tone: 'neutral' },
};

export const ONBOARDING_STEPS: Record<
  OnboardingStepKey,
  { label: string; description: string; href: string; cta: string }
> = {
  product: {
    label: 'Adaugă prima excursie',
    description: 'Numele, durata, locul de îmbarcare și prețurile pe categorii.',
    href: '/o/products',
    cta: 'Adaugă excursia',
  },
  departures: {
    label: 'Programează plecările',
    description: 'Zilele, orele și locurile disponibile, sau conectează sistemul tău de rezervări.',
    href: '/o/products',
    cta: 'Adaugă plecări',
  },
  commission_plan: {
    label: 'Stabilește comisionul afiliaților',
    description: 'Un procent fix sau niveluri care cresc cu vânzările din lună.',
    href: '/o/plans',
    cta: 'Creează planul',
  },
  affiliate: {
    label: 'Invită primul afiliat',
    description: 'Un recepționer sau concierge primește linkul și codul QR pe telefon.',
    href: '/o/affiliates',
    cta: 'Invită un afiliat',
  },
  first_booking: {
    label: 'Prima rezervare',
    description: 'Când un turist rezervă prin afiliat sau pe pagina ta, pasul se bifează singur.',
    href: '/o/bookings',
    cta: 'Vezi rezervările',
  },
};

export const CURRENCIES = ['RON', 'EUR', 'BGN', 'HUF', 'USD', 'GBP'] as const;

/** Whole days from now until `iso` (0 when already past). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}
