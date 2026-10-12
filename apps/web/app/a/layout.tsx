import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AffiliateShell } from './AffiliateShell';

export const metadata: Metadata = {
  title: { default: 'Afiliat', template: '%s · Afiliat' },
};

export default function AffiliateLayout({ children }: { children: ReactNode }) {
  return <AffiliateShell>{children}</AffiliateShell>;
}
