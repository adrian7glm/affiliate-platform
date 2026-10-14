import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { IntegrationsScreen } from './IntegrationsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('integrations.title') };
}

export default function IntegrationsPage() {
  return <IntegrationsScreen />;
}
