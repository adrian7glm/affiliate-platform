'use client';

import { useCallback } from 'react';
import { AuthGate, useSession } from '@/components/AuthGate';
import { useT } from '@/components/I18nProvider';
import Link from 'next/link';
import { IconLogout, IconShield } from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ScanScreen } from '@/components/scanner/ScanScreen';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { scannerApi } from '@/lib/endpoints';
import { useApi } from '@/lib/useApi';

/**
 * The whole app for boarding staff: one screen with the scanner, the operator's name and a
 * count of today's scans. Nothing about bookings, affiliates or money.
 */
export function ScannerApp() {
  return (
    <AuthGate area="scanner">
      <ScannerFrame />
    </AuthGate>
  );
}

function ScannerFrame() {
  const { t, tp } = useT();
  const { me, membership, logout } = useSession();
  const context = useApi(`scanner-context:${membership.tenantId}`, (signal) =>
    scannerApi.context({ signal }),
  );
  const tenant = context.data?.tenant;
  const count = context.data?.scannedTodayByMe ?? null;
  const { setData } = context;

  const onScanned = useCallback(
    (result: { result: string }) => {
      if (result.result !== 'checked_in') return;
      setData((prev) => (prev ? { ...prev, scannedTodayByMe: prev.scannedTodayByMe + 1 } : prev));
    },
    [setData],
  );

  const who = me.user.name ?? me.user.phone ?? me.user.email ?? '';

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-30 border-b border-line bg-surface/95 py-2 page-x backdrop-blur"
        style={{ paddingTop: 'max(0.5rem, var(--safe-top))' }}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {tenant?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.logoUrl}
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-xl object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-bold">{tenant?.name ?? membership.tenantName}</p>
              <p className="truncate text-sm text-muted" aria-live="polite">
                {count === null
                  ? who
                  : count === 0
                    ? t('boarding.app.scannedTodayNone')
                    : tp('boarding.app.scannedToday', count)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <LanguageSwitcher compact />
            <Link
              href="/account"
              aria-label={t('account.link')}
              title={t('account.link')}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2"
            >
              <IconShield />
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              aria-label={t('boarding.app.logout')}
              title={t('boarding.app.logout')}
              className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2"
            >
              <IconLogout />
            </button>
          </div>
        </div>
      </header>
      <main id="content" className="page-x mx-auto max-w-xl py-4">
        <ScanScreen
          tenant={{
            timezone: tenant?.timezone ?? DEFAULT_TIMEZONE,
            currency: tenant?.currency ?? 'RON',
          }}
          showHeader={false}
          onScanned={onScanned}
        />
      </main>
    </div>
  );
}
