import type { Metadata } from 'next';
import { KitScreen } from './KitScreen';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('kit.meta.title') };
}

export default async function KitPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; format?: string }>;
}) {
  const { link, format } = await searchParams;
  return <KitScreen linkId={link} format={format} />;
}
