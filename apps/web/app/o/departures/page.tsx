import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@/components/Spinner';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { DeparturesScreen } from './DeparturesScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('operator.nav.departures') };
}

export default function DeparturesPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <DeparturesScreen />
    </Suspense>
  );
}
