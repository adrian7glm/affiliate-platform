import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { PlansScreen } from './PlansScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.plans') };
}

export default function PlansPage() {
  return <PlansScreen />;
}
