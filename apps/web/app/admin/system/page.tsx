import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { SystemAdmin } from './SystemAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.system.title') };
}

export default function AdminSystemPage() {
  return <SystemAdmin />;
}
