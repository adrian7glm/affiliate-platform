'use client';

import type { OperatorDashboardDto } from '@ap/contracts';
import { createContext, useContext } from 'react';
import type { ApiState } from '@/lib/useApi';

export interface OperatorTenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  /** The language the operator writes their trips in. */
  defaultLocale: string;
}

export interface OperatorContextValue {
  tenant: OperatorTenant;
  dashboard: ApiState<OperatorDashboardDto>;
}

export const OperatorContext = createContext<OperatorContextValue | null>(null);

/** Tenant facts (currency, timezone) for operator screens, from the dashboard payload. */
export function useOperator(): OperatorContextValue {
  const value = useContext(OperatorContext);
  if (!value) throw new Error('useOperator must be used inside the operator layout');
  return value;
}
