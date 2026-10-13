import type { AffiliateMonthDto, TierProgressDto } from '@ap/contracts';
import { intlLocale } from './format';
import { DEFAULT_LANG, type Lang } from './i18n';

/**
 * Small numbers for the affiliate dashboard: how the month compares, how many days are left,
 * what the next tier is worth on a typical booking.
 */

/** Days left in the period, today included (31 on 1 October, 1 on 31 October). */
export function daysLeftInPeriod(periodKey: string, todayKey: string): number {
  const [y, m] = periodKey.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (!todayKey.startsWith(periodKey)) return 0;
  const day = Number(todayKey.slice(8, 10));
  return Math.max(0, daysInMonth - day + 1);
}

/** Average value of a paid booking: this month if any, otherwise the whole history. */
export function averageSaleMinor(history: AffiliateMonthDto[]): number | null {
  const current = history.at(-1);
  if (current && current.paidSales > 0) return Math.round(current.salesMinor / current.paidSales);
  const sales = history.reduce((sum, m) => sum + m.paidSales, 0);
  if (sales === 0) return null;
  return Math.round(history.reduce((sum, m) => sum + m.salesMinor, 0) / sales);
}

/** Extra commission one average booking brings once the next tier is reached. */
export function nextTierExtraMinor(
  progress: TierProgressDto,
  averageMinor: number | null,
): number | null {
  if (averageMinor === null || progress.nextRateBps === null) return null;
  const extra = Math.round(
    (averageMinor * (progress.nextRateBps - progress.currentRateBps)) / 10_000,
  );
  return extra > 0 ? extra : null;
}

/** The best past month (not the current one) with any commission, if there is one. */
export function bestPastMonth(history: AffiliateMonthDto[]): AffiliateMonthDto | null {
  let best: AffiliateMonthDto | null = null;
  for (const month of history.slice(0, -1)) {
    if (month.commissionMinor > 0 && (!best || month.commissionMinor > best.commissionMinor)) {
      best = month;
    }
  }
  return best;
}

/** "oct." – short month name for chart axes. */
export function shortMonth(periodKey: string, lang: Lang = DEFAULT_LANG): string {
  const [y, m] = periodKey.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(lang), { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 15)))
    .replace(/\.$/, '');
}
