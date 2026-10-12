import type { Metadata } from 'next';
import { AdminOverview } from './AdminOverview';

export const metadata: Metadata = { title: 'Operatori' };

export default function AdminHomePage() {
  return <AdminOverview />;
}
