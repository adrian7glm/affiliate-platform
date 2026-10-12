import type { Metadata } from 'next';
import { Dashboard } from './Dashboard';

export const metadata: Metadata = { title: 'Panou' };

export default function OperatorDashboardPage() {
  return <Dashboard />;
}
