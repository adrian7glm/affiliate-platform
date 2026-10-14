import type { ApiError as ApiErrorBody } from '@ap/contracts';
import { getActiveLang } from './i18n';
import { STORAGE_KEYS, readString } from './storage';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

/** Event dispatched on `window` when an authenticated request comes back 401. */
export const UNAUTHORIZED_EVENT = 'ap:unauthorized';

/** Typed error for every failed API call. `status` is 0 when the network request itself failed. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** Translation key of the message (`errors.discounts.usedUp`), when the API sent one. */
  readonly key: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    key: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.key = key;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Send the `X-Tenant-Id` header (default: same as `auth`). */
  tenant?: boolean;
  signal?: AbortSignal;
  /** Override the base URL (server-side callers). */
  baseUrl?: string;
  /** Explicit token/tenant, bypassing localStorage (tests, server-side). */
  token?: string | null;
  tenantId?: string | null;
  /** Language for error messages (default: the page language). */
  lang?: string | null;
}

export function buildUrl(base: string, path: string, query?: Query): string {
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function parseErrorBody(status: number, body: unknown, fallback: string): ApiError {
  if (body && typeof body === 'object') {
    const b = body as Partial<ApiErrorBody> & { message?: unknown };
    const message = Array.isArray(b.message)
      ? b.message.join(', ')
      : typeof b.message === 'string'
        ? b.message
        : fallback;
    return new ApiError(
      status,
      typeof b.error === 'string' ? b.error : 'error',
      message,
      b.details,
      typeof b.code === 'string' ? b.code : null,
    );
  }
  return new ApiError(status, 'error', fallback);
}

/**
 * Typed fetch wrapper. Adds `Authorization: Bearer <token>` and `X-Tenant-Id` from
 * localStorage, parses JSON, maps 204 to `undefined` and throws `ApiError` otherwise.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, signal } = options;
  const sendTenant = options.tenant ?? auth;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const lang = options.lang !== undefined ? options.lang : getActiveLang();
  // A CORS-safelisted header, so it adds no preflight request.
  if (lang) headers['Accept-Language'] = lang;
  if (auth) {
    const token = options.token !== undefined ? options.token : readString(STORAGE_KEYS.token);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (sendTenant) {
    const tenantId =
      options.tenantId !== undefined ? options.tenantId : readString(STORAGE_KEYS.tenantId);
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
  }

  const url = buildUrl(options.baseUrl ?? API_URL, path, query);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'Network request failed');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && auth && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw parseErrorBody(res.status, parsed, res.statusText || `HTTP ${res.status}`);
  }

  return parsed as T;
}
