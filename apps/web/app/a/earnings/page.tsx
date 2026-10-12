import type { Metadata } from 'next';
import { EarningsScreen } from './EarningsScreen';

export const metadata: Metadata = { title: 'Câștigurile mele' };

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  return <EarningsScreen initialPeriod={period} />;
}
