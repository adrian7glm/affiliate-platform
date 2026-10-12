import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { OperatorShell } from './OperatorShell';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return {
    title: { default: t('operator.meta.area'), template: t('operator.meta.titleTemplate') },
  };
}

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
