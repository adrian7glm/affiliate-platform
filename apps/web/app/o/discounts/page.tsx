import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { DiscountsScreen } from './DiscountsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.discounts.title') };
}

export default function DiscountsPage() {
  return <DiscountsScreen />;
}
