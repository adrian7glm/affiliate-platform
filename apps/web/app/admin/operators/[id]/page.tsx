import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { OperatorDetail } from './OperatorDetail';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.operators.title') };
}

export default async function AdminOperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorDetail id={id} />;
}
