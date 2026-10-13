'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { AuthGate, useSession } from '@/components/AuthGate';
import { isActivePath } from '@/components/BottomNav';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useT } from '@/components/I18nProvider';
import {
  IconBanknote,
  IconBoat,
  IconClipboard,
  IconGauge,
  IconList,
  IconLogout,
  IconMenu,
  IconPercent,
  IconRefresh,
  IconScan,
  IconSettings,
  IconTag,
  IconTicket,
  IconUsers,
  IconWallet,
} from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import type { MessageKey } from '@/lib/i18n';
import { operatorApi } from '@/lib/endpoints';
import { roleLabel } from '@/lib/session';
import { useApi } from '@/lib/useApi';
import { OperatorContext, type OperatorContextValue } from './OperatorContext';

const NAV = [
  { href: '/o', label: 'operator.nav.dashboard', icon: <IconGauge />, exact: true },
  { href: '/o/bookings', label: 'operator.nav.bookings', icon: <IconList /> },
  { href: '/o/departures', label: 'operator.nav.departures', icon: <IconClipboard /> },
  { href: '/o/scan', label: 'operator.nav.scan', icon: <IconScan /> },
  { href: '/o/team', label: 'operator.nav.team', icon: <IconTicket /> },
  { href: '/o/affiliates', label: 'operator.nav.affiliates', icon: <IconUsers /> },
  { href: '/o/plans', label: 'operator.nav.plans', icon: <IconPercent /> },
  { href: '/o/discounts', label: 'operator.nav.discounts', icon: <IconTag /> },
  { href: '/o/products', label: 'operator.nav.products', icon: <IconBoat /> },
  { href: '/o/payouts', label: 'operator.nav.payouts', icon: <IconBanknote /> },
  { href: '/o/sources', label: 'operator.nav.sources', icon: <IconRefresh /> },
  { href: '/o/settings', label: 'operator.nav.settings', icon: <IconSettings /> },
  { href: '/o/billing', label: 'operator.nav.billing', icon: <IconWallet /> },
] as const satisfies readonly {
  href: string;
  label: MessageKey;
  icon: ReactNode;
  exact?: boolean;
}[];

export function OperatorShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="operator">
      <OperatorFrame>{children}</OperatorFrame>
    </AuthGate>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const { t } = useT();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isActivePath(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold ${
                active ? 'bg-brand-soft text-brand-soft-fg' : 'text-fg hover:bg-surface-2'
              }`}
            >
              {item.icon}
              {t(item.label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TenantSwitcher() {
  const { membership, memberships, switchTenant } = useSession();
  const { t } = useT();
  if (memberships.length <= 1) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-muted">{t('operator.nav.tenant')}</span>
      <select
        className="field-input block min-h-12 w-full rounded-xl border-2 border-line-strong bg-surface px-3 text-fg"
        value={membership.tenantId}
        onChange={(e) => switchTenant(e.target.value)}
      >
        {memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenantName}
          </option>
        ))}
      </select>
    </label>
  );
}

function OperatorFrame({ children }: { children: ReactNode }) {
  const { me, membership, logout } = useSession();
  const i18n = useT();
  const { t } = i18n;
  const [menuOpen, setMenuOpen] = useState(false);
  const dashboard = useApi(`operator-dashboard:${membership.tenantId}`, (signal) =>
    operatorApi.dashboard({ signal }),
  );

  const value = useMemo<OperatorContextValue>(() => {
    const loaded = dashboard.data?.tenant;
    return {
      dashboard,
      tenant: {
        id: membership.tenantId,
        name: loaded?.name ?? membership.tenantName,
        slug: loaded?.slug ?? membership.tenantSlug,
        currency: loaded?.currency ?? 'RON',
        timezone: loaded?.timezone ?? DEFAULT_TIMEZONE,
        defaultLocale: loaded?.defaultLocale ?? 'ro',
      },
    };
  }, [dashboard, membership]);

  const who = me.user.name ?? me.user.email ?? me.user.phone ?? '';
  const role = roleLabel(i18n, membership.role);

  return (
    <OperatorContext.Provider value={value}>
      <a href="#content" className="skip-link visually-hidden">
        {t('operator.nav.skipToContent')}
      </a>
      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[17rem_minmax(0,1fr)] print:block">
        {/* Desktop sidebar */}
        <aside className="no-print hidden border-r border-line bg-surface lg:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-5 overflow-y-auto p-4">
            <div>
              <p className="text-sm text-muted">{t('operator.nav.area')}</p>
              <p className="text-lg font-bold">{value.tenant.name}</p>
            </div>
            <TenantSwitcher />
            <nav aria-label={t('operator.nav.sections')}>
              <NavList />
            </nav>
            <div className="mt-auto border-t border-line pt-4">
              <p className="truncate text-sm font-semibold">{who}</p>
              <p className="text-sm text-muted">{role}</p>
              <div className="-ml-3 mt-2 flex flex-wrap items-center gap-1">
                <Button variant="ghost" icon={<IconLogout />} onClick={() => void logout()}>
                  {t('common.signOut')}
                </Button>
                <LanguageSwitcher />
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Phone / tablet top bar */}
          <header
            className="no-print sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/95 py-2 page-x backdrop-blur lg:hidden"
            style={{ paddingTop: 'max(0.5rem, var(--safe-top))' }}
          >
            <p className="min-w-0 truncate font-bold">{value.tenant.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href="/o/scan"
                className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-surface-2"
                aria-label={t('operator.nav.scan')}
              >
                <IconScan />
              </Link>
              <Button
                variant="secondary"
                icon={<IconMenu />}
                onClick={() => setMenuOpen(true)}
                aria-haspopup="dialog"
              >
                {t('operator.nav.menu')}
              </Button>
            </div>
          </header>

          <main
            id="content"
            tabIndex={-1}
            className="page-x mx-auto max-w-6xl pb-16 outline-none lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title={t('operator.nav.menu')}>
        <div className="flex flex-col gap-4">
          <TenantSwitcher />
          <nav aria-label={t('operator.nav.sections')}>
            <NavList onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="border-t border-line pt-3">
            <p className="truncate text-sm text-muted">
              {who} · {role}
            </p>
            <div className="-ml-3 flex flex-wrap items-center gap-1">
              <Button variant="ghost" icon={<IconLogout />} onClick={() => void logout()}>
                {t('common.signOut')}
              </Button>
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </Dialog>
    </OperatorContext.Provider>
  );
}
