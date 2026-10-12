import type { Metadata } from 'next';
import { PlansAdmin } from './PlansAdmin';

export const metadata: Metadata = { title: 'Planuri și tarife' };

export default function AdminPlansPage() {
  return <PlansAdmin />;
}
