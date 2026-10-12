import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { AffiliatesScreen } from './AffiliatesScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.affiliates') };
}

export default function AffiliatesPage() {
  return <AffiliatesScreen />;
}
