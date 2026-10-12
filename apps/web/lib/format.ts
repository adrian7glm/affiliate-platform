import { intlLocale } from '@ap/i18n';
import { DEFAULT_LANG, type Lang } from './i18n';

/**
 * Money and percentage formatting. Money is always integer minor units + ISO currency code.
 */

const fractionDigitsCache = new Map<string, number>();

/** Number of minor-unit digits of a currency (2 for RON/EUR, 0 for JPY...). */
export function currencyDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = fractionDigitsCache.get(code);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(code, digits);
  return digits;
}

export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyDigits(currency);
}

/** BCP 47 locale used for formatting in each UI language ("ro" → "ro-RO"). */
export { intlLocale };

/**
 * Formats integer minor units, e.g. `formatMoney(12050, 'RON', 'ro')` → "120,50 RON".
 * Whole amounts drop the decimals ("120 RON") where the browser supports it.
 */
export function formatMoney(amountMinor: number, currency: string, lang: Lang = DEFAULT_LANG): string {
  const code = (currency || 'RON').toUpperCase();
  const value = minorToMajor(amountMinor, code);
  try {
    return new Intl.NumberFormat(intlLocale(lang), {
      style: 'currency',
      currency: code,
      trailingZeroDisplay: 'stripIfInteger',
    } as Intl.NumberFormatOptions).format(value);
  } catch {
    return `${value.toFixed(currencyDigits(code))} ${code}`;
  }
}

/**
 * Parses an amount typed by a person ("120", "120,5", "1.234,50", "1,234.50") into minor units.
 * Returns null when the text is not a valid non-negative amount.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '');
  if (!cleaned) return null;
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized: string;
  if (decimalIndex === -1) {
    normalized = cleaned;
  } else {
    const decimals = cleaned.slice(decimalIndex + 1);
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
    // "1.234" or "1,234" with three digits after a single separator is a thousands separator.
    const separatorCount = (cleaned.match(/[.,]/g) ?? []).length;
    if (
      decimals.length === 3 &&
      separatorCount === 1 &&
      integer.length > 0 &&
      integer.length <= 3 &&
      integer !== '0'
    ) {
      normalized = integer + decimals;
    } else {
      normalized = `${integer || '0'}.${decimals}`;
    }
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  const digits = currencyDigits(currency);
  return Math.round(value * 10 ** digits);
}

/** Basis points → human percentage, e.g. 1250 → "12,5%" (ro) or "12.5%" (en). */
export function formatBps(bps: number, lang: Lang = DEFAULT_LANG): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/** Percentage typed by a person ("12,5" or "12.5") → basis points (1250). Null when invalid. */
export function percentToBps(text: string): number | null {
  const cleaned = text.trim().replace('%', '').replace(',', '.').trim();
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 10_000) return null;
  return bps;
}

/** Basis points → editable percentage text (1250 → "12.5"). */
export function bpsToPercentInput(bps: number): string {
  return String(bps / 100);
}

/** Major-unit text for an editable amount input (12050 RON → "120.5"). */
export function minorToInput(amountMinor: number, currency: string): string {
  return String(minorToMajor(amountMinor, currency));
}

/** Turns a display name into a URL slug: "Plimbare cu barca – Delta" → "plimbare-cu-barca-delta". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Price code from a label: "Adult (12+)" → "adult_12". */
export function priceCode(text: string): string {
  return slugify(text).replace(/-/g, '_').slice(0, 40) || 'price';
}
