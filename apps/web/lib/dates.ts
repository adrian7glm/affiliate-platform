import { intlLocale } from './format';

/**
 * Calendar helpers. Departures are instants (ISO strings); people think in the operator's local
 * calendar, so every "which day is it" question is answered in the tenant timezone.
 */

export const DEFAULT_TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'Europe/Bucharest';

function safeTz(tz: string | null | undefined): string {
  const zone = tz || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD of an instant in a timezone. */
export function dateKeyInTz(date: Date | string, tz?: string | null): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function todayKey(tz?: string | null, now: Date = new Date()): string {
  return dateKeyInTz(now, tz);
}

/** Adds calendar days to a YYYY-MM-DD key (pure calendar arithmetic, no DST issues). */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** The next `count` calendar days starting today, as YYYY-MM-DD keys. */
export function nextDays(count: number, tz?: string | null, now: Date = new Date()): string[] {
  const start = todayKey(tz, now);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD key. */
export function isoWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Short label of a calendar day: "mie. 14 oct." / "Wed 14 Oct". */
export function formatDayLabel(dateKey: string, lang = 'ro'): { weekday: string; day: string } {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const locale = intlLocale(lang);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
    .format(date)
    .replace(/\.$/, '');
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(date)
    .replace(/\.$/, '');
  return { weekday, day };
}

/** Long date of a calendar day: "miercuri, 14 octombrie". */
export function formatDayLong(dateKey: string, lang = 'ro'): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat(intlLocale(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/** "10:30" in the tenant timezone. */
export function formatTime(iso: string, tz?: string | null, lang = 'ro'): string {
  return new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: safeTz(tz),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** "mie. 14 oct., 10:30" in the tenant timezone. */
export function formatDateTime(iso: string, tz?: string | null, lang = 'ro'): string {
  return new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: safeTz(tz),
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** "14 oct. 2026" in the tenant timezone. */
export function formatDate(iso: string, tz?: string | null, lang = 'ro'): string {
  return new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: safeTz(tz),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------------------------
// Commission periods (YYYY-MM)
// ---------------------------------------------------------------------------------------------

export function currentPeriod(tz?: string | null, now: Date = new Date()): string {
  return todayKey(tz, now).slice(0, 7);
}

export function isPeriodKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "octombrie 2026". */
export function formatPeriod(period: string, lang = 'ro'): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(intlLocale(lang), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** Greeting for the local hour. */
export function greetingRo(now: Date = new Date(), tz?: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: safeTz(tz),
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  if (hour < 11) return 'Bună dimineața';
  if (hour < 18) return 'Bună ziua';
  return 'Bună seara';
}
