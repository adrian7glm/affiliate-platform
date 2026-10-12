'use client';

import type { MeDto } from '@ap/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { isActivePath } from '@/components/BottomNav';
import { Button, ButtonLink } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { IconGauge, IconLink, IconLogout, IconMenu, IconPercent } from '@/components/icons';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { APP_NAME } from '@/lib/brand';
import { authApi } from '@/lib/endpoints';
import { clearSession, getCachedMe, getToken, setCachedMe } from '@/lib/session';
import { errorMessageRo } from '@/lib/useApi';

const NAV = [
  { href: '/admin', label: 'Operatori', icon: <IconGauge />, exact: true },
  { href: '/admin/plans', label: 'Planuri și tarife', icon: <IconPercent /> },
  { href: '/admin/invites', label: 'Invitații', icon: <IconLink /> },
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
          title="Nu am putut încărca contul"
          action={
            <Button variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
              Încearcă din nou
            </Button>
          }
        >
          {errorMessageRo(state.error)}
        </Alert>
      </main>
    );
  }
  if (state.status === 'denied') {
    return (
      <main className="page-x mx-auto flex max-w-xl flex-col gap-4 py-10">
        <h1 className="text-2xl font-bold">Zona proprietarului platformei</h1>
        <p className="text-muted">
          Contul {state.me.user.email ?? state.me.user.phone} nu are acces aici. Dacă ești
          proprietarul platformei, intră cu adresa de email setată ca administrator.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/login">Alege alt cont</ButtonLink>
          <Button variant="secondary" icon={<IconLogout />} onClick={() => void logout()}>
            Ieși din cont
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
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function OperatorConsoles({ me, onNavigate }: { me: MeDto; onNavigate?: () => void }) {
  const own = me.memberships.filter((m) => m.role !== 'affiliate');
  if (own.length === 0) return null;
  return (
    <Link
      href="/login"
      onClick={onNavigate}
      className="flex min-h-12 items-center rounded-xl px-3 text-sm font-semibold text-brand hover:bg-surface-2"
    >
      Mergi la contul tău de operator
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
  const [menuOpen, setMenuOpen] = useState(false);
  const who = me.user.name ?? me.user.email ?? '';
  return (
    <>
      <a href="#content" className="skip-link visually-hidden">
        Sari la conținut
      </a>
      <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-surface lg:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-5 overflow-y-auto p-4">
            <div>
              <p className="text-sm text-muted">Administrare platformă</p>
              <p className="text-lg font-bold">{APP_NAME}</p>
            </div>
            <nav aria-label="Secțiuni">
              <NavList />
            </nav>
            <div className="mt-auto border-t border-line pt-4">
              <OperatorConsoles me={me} />
              <p className="truncate text-sm font-semibold">{who}</p>
              <p className="text-sm text-muted">Proprietar platformă</p>
              <Button
                variant="ghost"
                icon={<IconLogout />}
                onClick={onLogout}
                className="-ml-3 mt-2"
              >
                Ieși din cont
              </Button>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-surface/95 py-2 page-x backdrop-blur lg:hidden"
            style={{ paddingTop: 'max(0.5rem, var(--safe-top))' }}
          >
            <p className="min-w-0 truncate font-bold">Administrare platformă</p>
            <Button
              variant="secondary"
              icon={<IconMenu />}
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
            >
              Meniu
            </Button>
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
          <nav aria-label="Secțiuni">
            <NavList onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="border-t border-line pt-3">
            <OperatorConsoles me={me} onNavigate={() => setMenuOpen(false)} />
            <p className="truncate text-sm text-muted">{who} · Proprietar platformă</p>
            <Button variant="ghost" icon={<IconLogout />} onClick={onLogout} className="-ml-3">
              Ieși din cont
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
