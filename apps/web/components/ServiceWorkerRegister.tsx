'use client';

import { useEffect } from 'react';
import { API_URL } from '@/lib/api';

/**
 * Registers /sw.js (production builds, or dev with NEXT_PUBLIC_ENABLE_SW_IN_DEV=1).
 * The API origin is passed to the worker so it can apply network-first caching to API reads.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    const enabled =
      process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === '1';
    if (!enabled || !('serviceWorker' in navigator)) return;

    const register = () => {
      const url = `/sw.js?api=${encodeURIComponent(API_URL)}`;
      navigator.serviceWorker.register(url, { scope: '/' }).catch(() => {
        // Registration fails on insecure origins or when blocked; the app works without it.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
