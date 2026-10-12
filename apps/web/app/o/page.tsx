import type { Metadata } from 'next';
import { Dashboard } from './Dashboard';
import { SetupChecklist } from './SetupChecklist';

export const metadata: Metadata = { title: 'Panou' };

export default function OperatorDashboardPage() {
  return (
    <>
      <SetupChecklist />
      <Dashboard />
    </>
  );
}
