import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { SettingsAdmin } from './SettingsAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.settings.title') };
}

export default function AdminSettingsPage() {
  return <SettingsAdmin />;
}
