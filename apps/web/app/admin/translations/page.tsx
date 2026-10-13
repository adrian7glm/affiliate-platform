import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { LanguagesAdmin } from './LanguagesAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('translations.title') };
}

export default function AdminTranslationsPage() {
  return <LanguagesAdmin />;
}
