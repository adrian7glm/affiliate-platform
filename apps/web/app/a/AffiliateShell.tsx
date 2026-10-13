'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { BottomNav, type BottomNavItem } from '@/components/BottomNav';
import { useT } from '@/components/I18nProvider';
import { IconCalendarPlus, IconHome, IconQr, IconWallet } from '@/components/icons';

export function AffiliateShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const nav: BottomNavItem[] = [
    { href: '/a', label: t('affiliate.nav.home'), icon: <IconHome />, exact: true },
    { href: '/a/qr', label: t('affiliate.nav.qr'), icon: <IconQr /> },
    { href: '/a/book', label: t('affiliate.nav.book'), icon: <IconCalendarPlus /> },
    { href: '/a/earnings', label: t('affiliate.nav.earnings'), icon: <IconWallet /> },
  ];
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
      {isPrint ? null : <BottomNav items={nav} label={t('affiliate.nav.label')} />}
    </AuthGate>
  );
}
