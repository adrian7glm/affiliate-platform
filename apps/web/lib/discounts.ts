import type { DiscountCodeDto, DiscountPreviewDto } from '@ap/contracts';
import { isApiError } from './api';
import { formatBps, formatMoney } from './format';
import type { Lang, MessageKey } from './i18n';

/** "−10%" or "−20,00 lei". */
export function discountText(
  code: Pick<DiscountPreviewDto, 'percentBps' | 'amountMinor'>,
  currency: string,
  lang: Lang,
): string {
  return `−${
    code.percentBps != null
      ? formatBps(code.percentBps, lang)
      : formatMoney(code.amountMinor ?? 0, currency, lang)
  }`;
}

/** What customers type, as the API keeps it: upper case, no spaces. */
export function normalizeCode(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

const REASONS: Record<string, MessageKey> = {
  'errors.discounts.invalid': 'public.discount.invalid',
  'errors.discounts.notToday': 'public.discount.notToday',
  'errors.discounts.notForTrip': 'public.discount.notForTrip',
  'errors.discounts.usedUp': 'public.discount.usedUp',
  'errors.discounts.otherAffiliate': 'public.discount.otherAffiliate',
};

/** Why a code was refused, as a message of the page; null for errors that are not about the code. */
export function discountErrorKey(err: unknown): MessageKey | null {
  if (!isApiError(err) || !err.key) return null;
  return REASONS[err.key] ?? null;
}

/** Whether a code can still be used today (in the operator's timezone `today`, YYYY-MM-DD). */
export function codeState(
  code: Pick<DiscountCodeDto, 'active' | 'validFrom' | 'validUntil' | 'maxUses' | 'uses'>,
  today: string,
): 'active' | 'paused' | 'scheduled' | 'expired' | 'usedUp' {
  if (!code.active) return 'paused';
  if (code.validUntil && today > code.validUntil) return 'expired';
  if (code.maxUses !== null && code.uses >= code.maxUses) return 'usedUp';
  if (code.validFrom && today < code.validFrom) return 'scheduled';
  return 'active';
}
