import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { OperatorScan } from './OperatorScan';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('boarding.scan.title') };
}

export default function ScanPage() {
  return <OperatorScan />;
}
