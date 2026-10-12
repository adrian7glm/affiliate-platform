import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { InvitesAdmin } from './InvitesAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.invites.title') };
}

export default function AdminInvitesPage() {
  return <InvitesAdmin />;
}
