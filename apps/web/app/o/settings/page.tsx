import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { SettingsScreen } from './SettingsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('catalog.settings.title') };
}

export default function SettingsPage() {
  return <SettingsScreen />;
}
