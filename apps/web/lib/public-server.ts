import type { ProductDto, PublicTenantDto } from '@ap/contracts';
import { headers } from 'next/headers';
import { cache } from 'react';
import { isApiError } from './api';
import { publicApi } from './endpoints';
import { DEFAULT_LANG, langFromAcceptLanguage, langFromTag, type Lang } from './i18n';
import { SERVER_API_URL } from './server-api';

/** Server-side helpers for the public (tourist) pages. */

export type Loaded<T> = { ok: true; data: T } | { ok: false; notFound: boolean };

async function load<T>(request: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await request() };
  } catch (err) {
    return { ok: false, notFound: isApiError(err) && (err.isNotFound || err.status === 400) };
  }
}

/** Memoized per request, so generateMetadata and the page share one API call. */
export const loadTenant = cache((slug: string) =>
  load<PublicTenantDto>(() => publicApi.tenant(slug, { baseUrl: SERVER_API_URL })),
);

export const loadProduct = cache((slug: string, productSlug: string) =>
  load<ProductDto>(() => publicApi.product(slug, productSlug, { baseUrl: SERVER_API_URL })),
);

/** `?lang=` wins, then the browser's preferred language (Accept-Language), then English. */
export async function requestLang(queryLang: string | string[] | undefined): Promise<Lang> {
  const fromQuery = langFromTag(Array.isArray(queryLang) ? queryLang[0] : queryLang);
  if (fromQuery) return fromQuery;
  const accept = (await headers()).get('accept-language');
  return langFromAcceptLanguage(accept) ?? DEFAULT_LANG;
}

/** Appends `lang` to an internal path. */
export function withLang(path: string, lang: Lang): string {
  return `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`;
}
