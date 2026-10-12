import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { AdminShell } from './AdminShell';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  const title = t('admin.meta.title');
  return {
    title: { default: title, template: `%s · ${title}` },
    robots: { index: false, follow: false },
  };
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
