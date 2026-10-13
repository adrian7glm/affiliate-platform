'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from './api';
import type { Translator } from './i18n';

export interface ApiState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Re-runs the request, keeping the current data visible while it loads. */
  reload: () => void;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/**
 * Minimal data-fetching hook: runs `fetcher` when `key` changes, aborts stale requests and
 * exposes loading/error state. Pass `key = null` to skip.
 */
export function useApi<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: { initialData?: T | null } = {},
): ApiState<T> {
  const [data, setData] = useState<T | null>(options.initialData ?? null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(key !== null);
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);

  useEffect(() => {
    // A different resource: drop the previous one's data instead of showing it while loading.
    if (keyRef.current !== key) {
      keyRef.current = key;
      setData(null);
    }
    if (key === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return { data, error, loading, reload, setData };
}

/** Human message, in the page language, for an error thrown by the API client. */
export function errorMessage(
  err: unknown,
  translator: Pick<Translator, 't'> | Translator['t'],
): string {
  const t = typeof translator === 'function' ? { t: translator } : translator;
  if (isApiError(err)) {
    if (err.isNetwork) return t.t('common.errorNetwork');
    if (err.status === 401) return t.t('common.errorSession');
    if (err.status === 403 && !err.message) return t.t('common.errorForbidden');
    if (err.status === 404 && !err.message) return t.t('common.errorNotFound');
    if (err.status === 429) return t.t('common.errorTooMany');
    if (err.status >= 500) return t.t('common.errorServer');
    // The API translates its own messages (it gets the page language in Accept-Language).
    return err.message || t.t('common.errorRequest');
  }
  return t.t('common.errorGeneric');
}
