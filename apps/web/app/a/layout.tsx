import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { AffiliateShell } from './AffiliateShell';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  const area = t('affiliate.meta.area');
  return { title: { default: area, template: `%s · ${area}` } };
}

export default function AffiliateLayout({ children }: { children: ReactNode }) {
  return <AffiliateShell>{children}</AffiliateShell>;
}
