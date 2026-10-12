'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { BottomNav, type BottomNavItem } from '@/components/BottomNav';
import { IconCalendarPlus, IconHome, IconQr, IconWallet } from '@/components/icons';

const NAV: BottomNavItem[] = [
  { href: '/a', label: 'Acasă', icon: <IconHome />, exact: true },
  { href: '/a/qr', label: 'QR', icon: <IconQr /> },
  { href: '/a/book', label: 'Rezervă', icon: <IconCalendarPlus /> },
  { href: '/a/earnings', label: 'Câștiguri', icon: <IconWallet /> },
];

export function AffiliateShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const isPrint = pathname.endsWith('/print');

  return (
    <AuthGate area="affiliate">
      <main
        id="content"
        className={isPrint ? '' : 'min-h-dvh'}
        style={
          isPrint
            ? undefined
            : {
                paddingTop: 'var(--safe-top)',
                paddingBottom: 'calc(var(--nav-h) + var(--safe-bottom) + 1.5rem)',
              }
        }
      >
        {children}
      </main>
      {isPrint ? null : <BottomNav items={NAV} />}
    </AuthGate>
  );
}
