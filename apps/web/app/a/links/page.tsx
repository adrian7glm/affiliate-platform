import type { Metadata } from 'next';
import { LinksScreen } from './LinksScreen';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('affiliate.meta.links') };
}

export default function LinksPage() {
  return <LinksScreen />;
}
