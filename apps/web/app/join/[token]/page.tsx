import type { Metadata } from 'next';
import { JoinFlow } from './JoinFlow';

export const metadata: Metadata = { title: 'Invitație' };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinFlow token={token} />;
}
