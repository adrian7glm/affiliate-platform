import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { StartFlow } from './StartFlow';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('signup.meta.title'), description: t('signup.meta.description') };
}

export default function StartPage() {
  return <StartFlow token={null} />;
}
