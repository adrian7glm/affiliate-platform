import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { TranslationEditor } from './TranslationEditor';

interface Props {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('translations.title') };
}

export default async function AdminTranslationEditorPage({ params }: Props) {
  const { lang } = await params;
  return <TranslationEditor code={decodeURIComponent(lang)} />;
}
