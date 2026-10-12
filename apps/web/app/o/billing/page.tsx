import type { Metadata } from 'next';
import { BillingScreen } from './BillingScreen';

export const metadata: Metadata = { title: 'Abonament' };

export default function BillingPage() {
  return <BillingScreen />;
}
