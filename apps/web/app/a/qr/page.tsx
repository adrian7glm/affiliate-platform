import type { Metadata } from 'next';
import { QrScreen } from './QrScreen';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('affiliate.meta.qr') };
}

export default function QrPage() {
  return <QrScreen />;
}
