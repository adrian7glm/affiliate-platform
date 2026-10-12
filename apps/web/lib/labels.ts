import type {
  AffiliateDto,
  BookingChannel,
  BookingStatus,
  CommissionEntryDto,
  PayoutDto,
} from '@ap/contracts';
import type { Tone } from '@/components/StatusChip';

/** Romanian labels and tones for statuses shown on affiliate and operator screens. */

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: 'Așteaptă plata', tone: 'warning' },
  confirmed: { label: 'Confirmată', tone: 'success' },
  cancelled: { label: 'Anulată', tone: 'danger' },
  refunded: { label: 'Rambursată', tone: 'neutral' },
  expired: { label: 'Expirată', tone: 'neutral' },
};

export const BOOKING_CHANNEL: Record<BookingChannel, string> = {
  link: 'Link',
  qr: 'Cod QR',
  affiliate_assisted: 'Rezervare de afiliat',
  promo_code: 'Cod promoțional',
  direct: 'Direct',
};

export const COMMISSION_STATUS: Record<
  CommissionEntryDto['status'],
  { label: string; tone: Tone }
> = {
  pending: { label: 'În așteptare', tone: 'warning' },
  approved: { label: 'Aprobat', tone: 'brand' },
  paid: { label: 'Plătit', tone: 'success' },
};

export const COMMISSION_KIND: Record<CommissionEntryDto['kind'], string> = {
  sale: 'Vânzare',
  adjustment: 'Ajustare',
  reversal: 'Anulare',
};

export const AFFILIATE_STATUS: Record<AffiliateDto['status'], { label: string; tone: Tone }> = {
  invited: { label: 'Invitat', tone: 'warning' },
  active: { label: 'Activ', tone: 'success' },
  suspended: { label: 'Suspendat', tone: 'danger' },
};

export const PAYOUT_STATUS: Record<PayoutDto['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Ciornă', tone: 'neutral' },
  approved: { label: 'De plătit', tone: 'warning' },
  paid: { label: 'Plătit', tone: 'success' },
  failed: { label: 'Eșuat', tone: 'danger' },
};

export const PAYOUT_METHOD: Record<PayoutDto['method'], string> = {
  manual: 'Manual',
  stripe_connect: 'Stripe Connect',
};

export const LOCALE_LABELS: Record<'ro' | 'en' | 'de' | 'fr' | 'it', string> = {
  ro: 'Română',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
};
