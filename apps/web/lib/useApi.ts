'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from './api';

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

/** Romanian, human message for an error thrown by the API client. */
export function errorMessageRo(err: unknown): string {
  if (isApiError(err)) {
    if (err.isNetwork) return 'Nu ai conexiune la internet. Verifică și încearcă din nou.';
    if (err.status === 401) return 'Sesiunea a expirat. Intră din nou în cont.';
    if (err.status === 403) return 'Nu ai acces la această secțiune.';
    if (err.status === 404) return 'Nu am găsit ce căutai.';
    if (err.status === 409)
      return err.message || 'Operațiunea intră în conflict cu datele existente.';
    if (err.status === 429) return 'Prea multe încercări. Așteaptă puțin și încearcă din nou.';
    if (err.status >= 500)
      return 'Serverul nu răspunde momentan. Încearcă din nou în câteva secunde.';
    return err.message || 'Cererea nu a putut fi procesată.';
  }
  return 'Ceva n-a mers. Încearcă din nou.';
}
