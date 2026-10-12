'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { AuthGate, useSession } from '@/components/AuthGate';
import { isActivePath } from '@/components/BottomNav';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import {
  IconBanknote,
  IconBoat,
  IconGauge,
  IconList,
  IconLogout,
  IconMenu,
  IconPercent,
  IconRefresh,
  IconScan,
  IconTicket,
  IconUsers,
} from '@/components/icons';
import { BOARDING_TEXT } from '@/lib/boarding-text';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { ROLE_LABELS_RO } from '@/lib/session';
import { useApi } from '@/lib/useApi';
import { OperatorContext, type OperatorContextValue } from './OperatorContext';

const NAV = [
  { href: '/o', label: 'Panou', icon: <IconGauge />, exact: true },
  { href: '/o/bookings', label: 'Rezervări', icon: <IconList /> },
  { href: '/o/scan', label: BOARDING_TEXT.scanTitle, icon: <IconScan /> },
  { href: '/o/team', label: BOARDING_TEXT.teamNav, icon: <IconTicket /> },
  { href: '/o/affiliates', label: 'Afiliați', icon: <IconUsers /> },
  { href: '/o/plans', label: 'Planuri de comision', icon: <IconPercent /> },
  { href: '/o/products', label: 'Excursii și plecări', icon: <IconBoat /> },
  { href: '/o/payouts', label: 'Comisioane și plăți', icon: <IconBanknote /> },
  { href: '/o/sources', label: 'Sistemul de rezervări', icon: <IconRefresh /> },
];

export function OperatorShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate area="operator">
      <OperatorFrame>{children}</OperatorFrame>
    </AuthGate>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
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
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TenantSwitcher() {
  const { membership, memberships, switchTenant } = useSession();
  if (memberships.length <= 1) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-muted">Operator</span>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const dashboard = useApi(`operator-dashboard:${membership.tenantId}`, (signal) =>
    operatorApi.dashboard({ signal }),
  );

  const value = useMemo<OperatorContextValue>(() => {
    const t = dashboard.data?.tenant;
    return {
      dashboard,
      tenant: {
        id: membership.tenantId,
        name: t?.name ?? membership.tenantName,
        slug: t?.slug ?? membership.tenantSlug,
        currency: t?.currency ?? 'RON',
        timezone: t?.timezone ?? DEFAULT_TIMEZONE,
      },
    };
  }, [dashboard, membership]);

  const who = me.user.name ?? me.user.email ?? me.user.phone ?? '';

  return (
    <OperatorContext.Provider value={value}>
      <a href="#content" className="skip-link visually-hidden">
        Sari la conținut
      </a>
      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="hidden border-r border-line bg-surface lg:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-5 overflow-y-auto p-4">
            <div>
              <p className="text-sm text-muted">Administrare</p>
              <p className="text-lg font-bold">{value.tenant.name}</p>
            </div>
            <TenantSwitcher />
            <nav aria-label="Secțiuni">
              <NavList />
            </nav>
            <div className="mt-auto border-t border-line pt-4">
              <p className="truncate text-sm font-semibold">{who}</p>
              <p className="text-sm text-muted">{ROLE_LABELS_RO[membership.role]}</p>
              <Button
                variant="ghost"
                icon={<IconLogout />}
                onClick={() => void logout()}
                className="-ml-3 mt-2"
              >
                Ieși din cont
              </Button>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Phone / tablet top bar */}
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/95 py-2 page-x backdrop-blur lg:hidden"
            style={{ paddingTop: 'max(0.5rem, var(--safe-top))' }}
          >
            <p className="min-w-0 truncate font-bold">{value.tenant.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href="/o/scan"
                className="inline-flex size-12 items-center justify-center rounded-xl text-brand hover:bg-surface-2"
                aria-label="Scanează bilete"
              >
                <IconScan />
              </Link>
              <Button
                variant="secondary"
                icon={<IconMenu />}
                onClick={() => setMenuOpen(true)}
                aria-haspopup="dialog"
              >
                Meniu
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

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Meniu">
        <div className="flex flex-col gap-4">
          <TenantSwitcher />
          <nav aria-label="Secțiuni">
            <NavList onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="border-t border-line pt-3">
            <p className="truncate text-sm text-muted">
              {who} · {ROLE_LABELS_RO[membership.role]}
            </p>
            <Button
              variant="ghost"
              icon={<IconLogout />}
              onClick={() => void logout()}
              className="-ml-3"
            >
              Ieși din cont
            </Button>
          </div>
        </div>
      </Dialog>
    </OperatorContext.Provider>
  );
}
