import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import {
  BUNDLED_LANGUAGES,
  DEFAULT_LANG,
  LANG_COOKIE,
  getT,
  langFromAcceptLanguage,
  langFromTag,
  type Lang,
  type LanguageInfo,
  type Messages,
  type Translator,
} from './i18n';
import { SERVER_API_URL } from './server-api';

/** Translations for server components and route handlers. */

const REVALIDATE_SECONDS = 60;

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Languages people can pick (the admin can add or hide some), else the bundled ones. */
export const serverLanguages = cache(async (): Promise<LanguageInfo[]> => {
  const result = await getJson<{ languages: LanguageInfo[] }>('/i18n/languages');
  return result?.languages?.length ? result.languages : BUNDLED_LANGUAGES;
});

/** The admin's texts for one language (empty when the API cannot be reached). */
export const serverOverrides = cache(async (lang: Lang): Promise<Messages> => {
  const result = await getJson<{ messages: Messages }>(
    `/i18n/messages/${encodeURIComponent(lang)}`,
  );
  return result?.messages ?? {};
});

/** `?lang=`, then the saved choice (cookie), then Accept-Language, then `fallback`. */
export async function serverLang(
  query?: string | string[] | null,
  fallback: Lang = DEFAULT_LANG,
): Promise<Lang> {
  const available = (await serverLanguages()).map((l) => l.code);
  const fromQuery = langFromTag(Array.isArray(query) ? query[0] : query, available);
  if (fromQuery) return fromQuery;
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  const fromCookie = langFromTag(saved, available);
  if (fromCookie) return fromCookie;
  const accept = (await headers()).get('accept-language');
  return (
    langFromAcceptLanguage(accept, available) ??
    (available.includes(fallback) ? fallback : (available[0] ?? fallback))
  );
}

/** Translator with the admin's overrides, for server-rendered pages. */
export async function getServerT(lang: Lang): Promise<Translator> {
  const overrides = await serverOverrides(lang);
  return Object.keys(overrides).length ? getT(lang, { [lang]: overrides }) : getT(lang);
}
