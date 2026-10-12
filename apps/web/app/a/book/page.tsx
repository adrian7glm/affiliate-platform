import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@/components/Spinner';
import { BookFlow } from './BookFlow';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('affiliate.meta.book') };
}

export default function BookPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BookFlow />
    </Suspense>
  );
}
