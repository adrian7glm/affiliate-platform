import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { TeamScreen } from './TeamScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('boarding.team.title') };
}

export default function TeamPage() {
  return <TeamScreen />;
}
