import type { Metadata } from 'next';
import { EarningsScreen } from './EarningsScreen';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('affiliate.meta.earnings') };
}

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  return <EarningsScreen initialPeriod={period} />;
}
