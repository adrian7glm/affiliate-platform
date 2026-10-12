import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { SourcesScreen } from './SourcesScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('catalog.sources.title') };
}

export default function SourcesPage() {
  return <SourcesScreen />;
}
