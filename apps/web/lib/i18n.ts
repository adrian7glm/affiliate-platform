import {
  BUNDLED_LANGS,
  bundledLanguages,
  createTranslator,
  intlLocale,
  matchAcceptLanguage,
  matchLanguage,
  type LanguageInfo,
  type MessageKey,
  type Messages,
  type Vars,
} from '@ap/i18n';

/**
 * Translations for every screen. Texts live in packages/i18n/src/locales/<lang>.json; the
 * platform admin can override any text or add a language at /admin/translations, and those
 * overrides are fetched from the API and layered on top.
 *
 * Language choice: `?lang=` (public pages), then the language the person picked before
 * (cookie + localStorage), then the browser language, then the default.
 */

export type { LanguageInfo, MessageKey, Messages, Vars };
export { intlLocale };

/** Any language code the platform offers ("ro", "en", "de"...). */
export type Lang = string;

/** Default for the staff screens (operators, affiliates, admin) when the browser language is not offered. */
export const DEFAULT_LANG: Lang = process.env.NEXT_PUBLIC_DEFAULT_LANG || 'ro';
/** Default for tourists on the public pages. */
export const PUBLIC_DEFAULT_LANG: Lang = 'en';

/** Remembers the chosen language; the cookie lets server-rendered pages use it too. */
export const LANG_COOKIE = 'ap_lang';
export const LANG_STORAGE_KEY = 'ap.lang';

export const BUNDLED_LANGUAGES: LanguageInfo[] = bundledLanguages();
export const LANGS: readonly Lang[] = BUNDLED_LANGS;

export function isLang(value: unknown, available: readonly Lang[] = LANGS): value is Lang {
  return typeof value === 'string' && available.includes(value);
}

/** Maps a BCP 47 tag ("ro-RO", "en-US", "mo") to an offered language, or null. */
export function langFromTag(
  tag: string | null | undefined,
  available: readonly Lang[] = LANGS,
): Lang | null {
  return matchLanguage(tag, available);
}

/** First offered language of an `Accept-Language` header. */
export function langFromAcceptLanguage(
  header: string | null | undefined,
  available: readonly Lang[] = LANGS,
): Lang | null {
  return matchAcceptLanguage(header, available);
}

/** `?lang=`, then the saved choice, then the browser languages, then `fallback`. */
export function pickLang(
  options: {
    query?: string | null;
    saved?: string | null;
    browser?: readonly string[] | string | null;
    available?: readonly Lang[];
  },
  fallback: Lang = DEFAULT_LANG,
): Lang {
  const available = options.available ?? LANGS;
  const browser =
    typeof options.browser === 'string' ? [options.browser] : (options.browser ?? []);
  return (
    langFromTag(options.query, available) ??
    langFromTag(options.saved, available) ??
    browser.map((tag) => langFromTag(tag, available)).find(Boolean) ??
    (available.includes(fallback) ? fallback : (available[0] ?? fallback))
  );
}

export interface Translator {
  lang: Lang;
  /** BCP 47 locale for Intl formatting ("ro-RO", "en-GB"). */
  locale: string;
  /** Translated text. With `{ count }` the plural form of the language is picked. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural shortcut: `tp('public.seatsLeft', 3)` = `t('public.seatsLeft', { count: 3 })`. */
  tp: (key: MessageKey, count: number, vars?: Vars) => string;
  /** For keys built at run time (statuses, error codes). */
  tk: (key: string, vars?: Vars) => string;
  has: (key: string) => boolean;
}

const cache = new Map<string, Translator>();

/**
 * Bound helpers for one language. `overrides` are the admin's texts per language
 * (`{ ro: { "public.book": "..." } }`), from the API.
 */
export function getT(lang: Lang, overrides?: Readonly<Record<string, Messages>>): Translator {
  const cacheKey = overrides ? null : lang;
  const hit = cacheKey ? cache.get(cacheKey) : undefined;
  if (hit) return hit;
  const base = createTranslator(lang, overrides);
  const translator: Translator = {
    lang,
    locale: intlLocale(lang),
    t: base.t,
    tk: base.tk,
    has: base.has,
    tp: (key, count, vars) => base.t(key, { ...vars, count }),
  };
  if (cacheKey) cache.set(cacheKey, translator);
  return translator;
}

/** Shortcut without overrides, for code outside React (tests, route handlers). */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return getT(lang).t(key, vars);
}

/** "1 h 30 min" style duration. */
export function formatDuration(minutes: number, lang: Lang = DEFAULT_LANG): string {
  const { t } = getT(lang);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('common.durationMinutes', { minutes: m });
  if (m === 0) return t('common.durationHours', { hours: h });
  return t('common.durationHoursMinutes', { hours: h, minutes: m });
}

// The language of the current page, for code outside React (the API client sends it so error
// messages come back translated).
let activeLang: Lang | null = null;

export function setActiveLang(lang: Lang): void {
  activeLang = lang;
}

export function getActiveLang(): Lang | null {
  if (activeLang) return activeLang;
  if (typeof document !== 'undefined') return document.documentElement.lang || null;
  return null;
}

/** Saves the choice in a cookie (read by server-rendered pages) and in localStorage. */
export function rememberLang(lang: Lang): void {
  try {
    document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Cookies blocked: the choice still applies to this page.
  }
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Storage blocked.
  }
}

export function savedLang(): string | null {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // Storage blocked.
  }
  try {
    const match = new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`).exec(document.cookie);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}
