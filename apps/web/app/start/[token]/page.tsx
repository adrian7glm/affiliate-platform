import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { StartFlow } from '../StartFlow';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('signup.meta.inviteTitle'), robots: { index: false } };
}

export default async function StartInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StartFlow token={token} />;
}
