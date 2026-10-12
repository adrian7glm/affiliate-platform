import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { AdminOverview } from './AdminOverview';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.overview.title') };
}

export default function AdminHomePage() {
  return <AdminOverview />;
}
