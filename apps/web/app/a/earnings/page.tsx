import type { Metadata } from 'next';
import { EarningsScreen } from './EarningsScreen';

export const metadata: Metadata = { title: 'Câștigurile mele' };

export default function EarningsPage() {
  return <EarningsScreen />;
}
