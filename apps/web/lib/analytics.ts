import type { TierProgressDto } from '@ap/contracts';
import { currencyDigits, intlLocale } from './format';
import { DEFAULT_LANG, type Lang } from './i18n';

/**
 * Pure helpers behind the operator dashboard charts, kept out of the components so they can be
 * unit tested.
 */

/** A round axis maximum at or above `max`: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max) ?? 10;
  return step * power;
}

/** Change from `previous` to `current` in whole percent; null when there is nothing to compare. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** `part` as a whole percentage of `total` (0 when the total is 0). */
export function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Short money for axis ticks: "0", "850", "2.500", "15 K" in the currency's major units. */
export function compactMoney(
  amountMinor: number,
  currency: string,
  lang: Lang = DEFAULT_LANG,
): string {
  const value = amountMinor / 10 ** currencyDigits(currency);
  return new Intl.NumberFormat(intlLocale(lang), {
    // Below 10 000 the whole number is short enough ("2.500") and reads better than "2,5 K".
    notation: value < 10_000 ? 'standard' : 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * How far an affiliate is through the climb to their next tier, as a 0..1 ratio counted from the
 * start of the month. A fixed rate, or the top tier, reads as complete.
 */
export function tierRatio(progress: TierProgressDto): number {
  if (progress.salesToNextTier === null) return 1;
  const target = progress.paidSales + progress.salesToNextTier;
  return target > 0 ? progress.paidSales / target : 0;
}

/** Which day labels to print under a month of columns: 1, 8, 15, 22, 29 and the last day. */
export function dayTicks(days: number): number[] {
  const ticks = [1, 8, 15, 22, 29].filter((d) => d <= days);
  // The last day only when it is not crowding the previous label.
  if (days - ticks[ticks.length - 1]! >= 3) ticks.push(days);
  return ticks;
}
