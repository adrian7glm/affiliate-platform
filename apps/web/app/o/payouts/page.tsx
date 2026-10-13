import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { PayoutsScreen } from './PayoutsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.payouts') };
}

export default function PayoutsPage() {
  return <PayoutsScreen />;
}
