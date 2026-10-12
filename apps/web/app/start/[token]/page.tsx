import type { Metadata } from 'next';
import { StartFlow } from '../StartFlow';

export const metadata: Metadata = { title: 'Invitație operator', robots: { index: false } };

export default async function StartInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StartFlow token={token} />;
}
