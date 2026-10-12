import type { Metadata } from 'next';
import { OperatorDetail } from './OperatorDetail';

export const metadata: Metadata = { title: 'Operator' };

export default async function AdminOperatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorDetail id={id} />;
}
