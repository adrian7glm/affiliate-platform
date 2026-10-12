import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OperatorShell } from './OperatorShell';

export const metadata: Metadata = {
  title: { default: 'Administrare', template: '%s · Administrare' },
};

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return <OperatorShell>{children}</OperatorShell>;
}
