import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { Dashboard } from './Dashboard';
import { SetupChecklist } from './SetupChecklist';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.dashboard') };
}

export default function OperatorDashboardPage() {
  return (
    <>
      <SetupChecklist />
      <Dashboard />
    </>
  );
}
