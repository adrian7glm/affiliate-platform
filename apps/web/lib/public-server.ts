import type { ProductDto, PublicTenantDto } from '@ap/contracts';
import { cache } from 'react';
import { isApiError } from './api';
import { publicApi } from './endpoints';
import { PUBLIC_DEFAULT_LANG, type Lang } from './i18n';
import { serverLang } from './i18n-server';
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

/**
 * Memoized per request, so generateMetadata and the page share one API call. The trips come in
 * `lang` where the operator translated them.
 */
export const loadTenant = cache((slug: string, lang: Lang) =>
  load<PublicTenantDto>(() => publicApi.tenant(slug, { baseUrl: SERVER_API_URL, lang })),
);

export const loadProduct = cache((slug: string, productSlug: string, lang: Lang) =>
  load<ProductDto>(() => publicApi.product(slug, productSlug, { baseUrl: SERVER_API_URL, lang })),
);

/** `?lang=` wins, then the saved choice, then the browser's language, then English. */
export function requestLang(queryLang: string | string[] | undefined): Promise<Lang> {
  return serverLang(queryLang, PUBLIC_DEFAULT_LANG);
}

/** Appends `lang` to an internal path. */
export function withLang(path: string, lang: Lang): string {
  return `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`;
}
