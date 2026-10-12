import type { Metadata } from 'next';
import { PosterScreen } from './PosterScreen';

export const metadata: Metadata = { title: 'Afiș de tipărit' };

export default async function PosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PosterScreen linkId={id} />;
}
