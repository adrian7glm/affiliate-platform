import type { Metadata } from 'next';
import { PayoutsScreen } from './PayoutsScreen';

export const metadata: Metadata = { title: 'Comisioane și plăți' };

export default function PayoutsPage() {
  return <PayoutsScreen />;
}
