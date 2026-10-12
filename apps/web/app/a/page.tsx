import type { Metadata } from 'next';
import { AffiliateHome } from './AffiliateHome';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('affiliate.meta.home') };
}

export default function AffiliateHomePage() {
  return <AffiliateHome />;
}
