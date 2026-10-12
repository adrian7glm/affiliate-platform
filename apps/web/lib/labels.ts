import type {
  AffiliateDto,
  BookingChannel,
  BookingStatus,
  CommissionEntryDto,
  PayoutDto,
} from '@ap/contracts';
import type { Tone } from '@/components/StatusChip';
import type { Translator } from './i18n';

/** Labels (from the `labels` section of the language files) and tones for statuses. */

export interface StatusLabel {
  label: string;
  tone: Tone;
}

const BOOKING_STATUS_TONE: Record<BookingStatus, Tone> = {
  pending_payment: 'warning',
  confirmed: 'success',
  cancelled: 'danger',
  refunded: 'neutral',
  expired: 'neutral',
};

export const bookingStatus = (t: Translator, status: BookingStatus): StatusLabel => ({
  label: t.tk(`labels.bookingStatus.${status}`),
  tone: BOOKING_STATUS_TONE[status],
});

export const bookingChannel = (t: Translator, channel: BookingChannel): string =>
  t.tk(`labels.bookingChannel.${channel}`);

export const BOOKING_CHANNELS: readonly BookingChannel[] = [
  'link',
  'qr',
  'affiliate_assisted',
  'promo_code',
  'direct',
];

const COMMISSION_STATUS_TONE: Record<CommissionEntryDto['status'], Tone> = {
  pending: 'warning',
  approved: 'brand',
  paid: 'success',
};

export const commissionStatus = (
  t: Translator,
  status: CommissionEntryDto['status'],
): StatusLabel => ({
  label: t.tk(`labels.commissionStatus.${status}`),
  tone: COMMISSION_STATUS_TONE[status],
});

export const commissionKind = (t: Translator, kind: CommissionEntryDto['kind']): string =>
  t.tk(`labels.commissionKind.${kind}`);

const AFFILIATE_STATUS_TONE: Record<AffiliateDto['status'], Tone> = {
  invited: 'warning',
  active: 'success',
  suspended: 'danger',
};

export const affiliateStatus = (t: Translator, status: AffiliateDto['status']): StatusLabel => ({
  label: t.tk(`labels.affiliateStatus.${status}`),
  tone: AFFILIATE_STATUS_TONE[status],
});

const PAYOUT_STATUS_TONE: Record<PayoutDto['status'], Tone> = {
  draft: 'neutral',
  approved: 'warning',
  paid: 'success',
  failed: 'danger',
};

export const payoutStatus = (t: Translator, status: PayoutDto['status']): StatusLabel => ({
  label: t.tk(`labels.payoutStatus.${status}`),
  tone: PAYOUT_STATUS_TONE[status],
});

export const payoutMethod = (t: Translator, method: PayoutDto['method']): string =>
  t.tk(`labels.payoutMethod.${method}`);
