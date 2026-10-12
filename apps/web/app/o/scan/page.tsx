import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { ScanScreen } from './ScanScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('catalog.scan.title') };
}

export default function ScanPage() {
  return <ScanScreen />;
}
