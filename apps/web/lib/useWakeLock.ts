'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps the screen on while the component is mounted (Screen Wake Lock API), re-acquiring the
 * lock when the page becomes visible again. Silently does nothing where unsupported.
 */
export function useWakeLock(enabled = true): { supported: boolean; active: boolean } {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    setSupported(true);
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
        setActive(true);
        lock.addEventListener('release', () => {
          sentinel = null;
          setActive(false);
        });
      } catch {
        setActive(false);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
      sentinel = null;
    };
  }, [enabled]);

  return { supported, active };
}
