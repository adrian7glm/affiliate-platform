import type { Metadata } from 'next';
import { PlansScreen } from './PlansScreen';

export const metadata: Metadata = { title: 'Planuri de comision' };

export default function PlansPage() {
  return <PlansScreen />;
}
