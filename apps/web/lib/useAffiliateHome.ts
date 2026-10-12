'use client';

import type { AffiliateHomeDto } from '@ap/contracts';
import { useState } from 'react';
import { useSession } from '@/components/AuthGate';
import { affiliateApi } from './endpoints';
import { STORAGE_KEYS, readJson, writeJson } from './storage';
import { useApi } from './useApi';

/**
 * The affiliate home payload, served instantly from localStorage (so the QR code and the
 * operator name render offline) and refreshed from the API.
 */
export function useAffiliateHome() {
  const { membership } = useSession();
  const key = STORAGE_KEYS.affiliateHome(membership.tenantId);
  // AuthGate renders its children only on the client, so reading storage here is safe.
  const [cached] = useState(() => readJson<AffiliateHomeDto>(key));
  const state = useApi<AffiliateHomeDto>(
    `affiliate-home:${membership.tenantId}`,
    (signal) =>
      affiliateApi.home({ signal }).then((home) => {
        writeJson(key, home);
        return home;
      }),
    { initialData: cached },
  );
  return {
    ...state,
    /** True when showing saved data because the latest request failed. */
    stale: !!state.error && !!state.data,
  };
}
