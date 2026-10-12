import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerT, serverLang } from '@/lib/i18n-server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  const title = t('boarding.app.title');
  return { title: { default: title, template: `%s · ${title}` } };
}

export default function ScannerLayout({ children }: { children: ReactNode }) {
  return children;
}
