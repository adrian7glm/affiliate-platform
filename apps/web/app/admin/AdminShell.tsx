'use client';

import type { MeDto } from '@ap/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { isActivePath } from '@/components/BottomNav';
import { Button, ButtonLink } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useT } from '@/components/I18nProvider';
import {
  IconGauge,
  IconGlobe,
  IconLink,
  IconLogout,
  IconMail,
  IconMenu,
  IconPercent,
  IconSettings,
} from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { authApi } from '@/lib/endpoints';
import { clearSession, getCachedMe, getToken, setCachedMe } from '@/lib/session';
import type { MessageKey } from '@/lib/i18n';
import { errorMessage } from '@/lib/useApi';

const NAV: { href: string; label: MessageKey; icon: ReactNode; exact?: boolean }[] = [
  { href: '/admin', label: 'admin.nav.operators', icon: <IconGauge />, exact: true },
  { href: '/admin/plans', label: 'admin.nav.plans', icon: <IconPercent /> },
  { href: '/admin/invites', label: 'admin.nav.invites', icon: <IconLink /> },
  { href: '/admin/contact', label: 'admin.nav.contact', icon: <IconMail /> },
  { href: '/admin/translations', label: 'admin.nav.translations', icon: <IconGlobe /> },
  { href: '/admin/settings', label: 'admin.nav.settings', icon: <IconSettings /> },
];

const AdminContext = createContext<MeDto | null>(null);

export function useAdmin(): MeDto {
  const me = useContext(AdminContext);
  if (!me) throw new Error('useAdmin must be used inside the admin layout');
  return me;
}

type GateState =
  | { status: 'checking' }
  | { status: 'ready'; me: MeDto }
  | { status: 'denied'; me: MeDto }
  | { status: 'error'; error: unknown };

/** The platform owner's area. Only accounts marked as platform admin get past the gate. */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const i18n = useT();
  const { t } = i18n;
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const apply = (me: MeDto) =>
      setState(me.user.isPlatformAdmin ? { status: 'ready', me } : { status: 'denied', me });
    const cached = getCachedMe();
    if (cached?.user.isPlatformAdmin) apply(cached);
    const controller = new AbortController();
    authApi
      .me({ signal: controller.signal })
      .then((me) => {
        setCachedMe(me);
        apply(me);
      })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(err) && err.isUnauthorized) {
          await clearSession();
          router.replace('/login?next=/admin');
          return;
        }
        setState({ status: 'error', error: err });
      });
    return () => controller.abort();
  }, [attempt, router]);

  async function logout() {
    await clearSession();
    router.replace('/login');
  }

  if (state.status === 'checking') {
    return (
      <main className="page-x mx-auto max-w-xl py-10" aria-busy="true">
        <LoadingBlock />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="page-x mx-auto max-w-xl py-10">
        <Alert
          tone="error"
          title={t('admin.shell.loadError')}
          action={
            <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(state.error, i18n)}
        </Alert>
      </main>
    );
  }
  if (state.status === 'denied') {
    return (
      <main className="page-x mx-auto flex max-w-xl flex-col gap-4 py-10">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl font-bold">{t('admin.shell.deniedTitle')}</h1>
        <p className="text-muted">
          {t('admin.shell.deniedBody', {
            account: state.me.user.email ?? state.me.user.phone ?? '',
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/login">{t('admin.shell.otherAccount')}</ButtonLink>
          <Button variant="secondary" icon={<IconLogout />} onClick={() => void logout()}>
            {t('admin.shell.logout')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <AdminContext.Provider value={state.me}>
      <AdminFrame me={state.me} onLogout={() => void logout()}>
        {children}
      </AdminFrame>
    </AdminContext.Provider>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const { t } = useT();
  return (
    <ul className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          isActivePath(pathname, item) ||
          (item.href === '/admin' && pathname.startsWith('/admin/operators'));
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

function OperatorConsoles({ me, onNavigate }: { me: MeDto; onNavigate?: () => void }) {
  const { t } = useT();
  const own = me.memberships.filter((m) => m.role !== 'affiliate');
  if (own.length === 0) return null;
  return (
    <Link
      href="/login"
      onClick={onNavigate}
      className="flex min-h-12 items-center rounded-xl px-3 text-sm font-semibold text-brand hover:bg-surface-2"
    >
      {t('admin.shell.operatorConsole')}
    </Link>
  );
}

function AdminFrame({
  me,
  onLogout,
  children,
}: {
  me: MeDto;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const who = me.user.name ?? me.user.email ?? '';
  return (
    <>
      <a href="#content" className="skip-link visually-hidden">
        {t('admin.shell.skipToContent')}
      </a>
      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-surface lg:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-5 overflow-y-auto p-4">
            <div>
              <p className="text-sm text-muted">{t('admin.shell.area')}</p>
              <p className="text-lg font-bold">{t('common.appName')}</p>
            </div>
            <nav aria-label={t('admin.shell.sections')}>
              <NavList />
            </nav>
            <div className="mt-auto border-t border-line pt-4">
              <OperatorConsoles me={me} />
              <p className="truncate text-sm font-semibold">{who}</p>
              <p className="text-sm text-muted">{t('admin.shell.role')}</p>
              <LanguageSwitcher className="-ml-2 mt-2" />
              <Button variant="ghost" icon={<IconLogout />} onClick={onLogout} className="-ml-3">
                {t('admin.shell.logout')}
              </Button>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/95 py-2 page-x backdrop-blur lg:hidden"
            style={{ paddingTop: 'max(0.5rem, var(--safe-top))' }}
          >
            <p className="min-w-0 truncate font-bold">{t('admin.shell.area')}</p>
            <div className="flex shrink-0 items-center gap-1">
              <LanguageSwitcher compact />
              <Button
                variant="secondary"
                icon={<IconMenu />}
                onClick={() => setMenuOpen(true)}
                aria-haspopup="dialog"
              >
                {t('admin.shell.menu')}
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

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title={t('admin.shell.menu')}>
        <div className="flex flex-col gap-4">
          <nav aria-label={t('admin.shell.sections')}>
            <NavList onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="border-t border-line pt-3">
            <OperatorConsoles me={me} onNavigate={() => setMenuOpen(false)} />
            <p className="truncate text-sm text-muted">
              {t('admin.shell.whoWithRole', { name: who })}
            </p>
            <LanguageSwitcher className="-ml-2" />
            <Button variant="ghost" icon={<IconLogout />} onClick={onLogout} className="-ml-3">
              {t('admin.shell.logout')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
