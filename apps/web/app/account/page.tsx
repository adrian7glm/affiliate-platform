import type { Metadata } from 'next';
import { AccountScreen } from './AccountScreen';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('account.meta.title') };
}

export default function AccountPage() {
  return <AccountScreen />;
}
