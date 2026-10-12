import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@/components/Spinner';
import { BookFlow } from './BookFlow';

export const metadata: Metadata = { title: 'Rezervă acum' };

export default function BookPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BookFlow />
    </Suspense>
  );
}
