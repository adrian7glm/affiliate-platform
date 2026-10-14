import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { AccountsAdmin } from './AccountsAdmin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('admin.accounts.title') };
}

export default function AdminAccountsPage() {
  return <AccountsAdmin />;
}
