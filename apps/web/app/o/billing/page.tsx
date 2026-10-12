import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { BillingScreen } from './BillingScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.billing') };
}

export default function BillingPage() {
  return <BillingScreen />;
}
