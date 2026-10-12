import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BOARDING_TEXT } from '@/lib/boarding-text';

export const metadata: Metadata = {
  title: {
    default: BOARDING_TEXT.scannerAppTitle,
    template: `%s · ${BOARDING_TEXT.scannerAppTitle}`,
  },
};

export default function ScannerLayout({ children }: { children: ReactNode }) {
  return children;
}
