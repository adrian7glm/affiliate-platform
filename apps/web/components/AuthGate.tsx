'use client';

import type { MeDto, MembershipDto } from '@ap/contracts';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UNAUTHORIZED_EVENT, isApiError } from '@/lib/api';
import { authApi } from '@/lib/endpoints';
import {
  AREA_ROLES,
  clearSession,
  getCachedMe,
  getTenantId,
  getToken,
  homePathForRole,
  pickMembership,
  setCachedMe,
  setTenantId,
  type Area,
} from '@/lib/session';
import { errorMessageRo } from '@/lib/useApi';
import { Alert } from './Alert';
import { Button } from './Button';
import { LoadingBlock } from './Spinner';

export interface SessionValue {
  me: MeDto;
  membership: MembershipDto;
  /** Memberships usable in this area (for the tenant switcher). */
  memberships: MembershipDto[];
  switchTenant: (tenantId: string) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <AuthGate>');
  return value;
}

type GateState =
  | { status: 'checking' }
  | { status: 'ready'; me: MeDto; membership: MembershipDto }
  | { status: 'error'; error: unknown }
  | { status: 'redirecting' };

/**
 * Guards an area of the app: requires a session token and a membership with a fitting role.
 * Renders immediately from the cached profile (so the affiliate app works offline) and
 * revalidates `/me` in the background.
 */
export function AuthGate({ area, children }: { area: Area; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  const goToLogin = useCallback(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    setState({ status: 'redirecting' });
    router.replace(`/login?next=${encodeURIComponent(pathname + search)}`);
  }, [pathname, router]);

  useEffect(() => {
    if (!getToken()) {
      goToLogin();
      return;
    }

    const apply = (me: MeDto) => {
      const membership = pickMembership(me.memberships, area, getTenantId());
      if (!membership) {
        const other = me.memberships[0];
        setState({ status: 'redirecting' });
        if (other) {
          setTenantId(other.tenantId);
          router.replace(homePathForRole(other.role));
        } else {
          router.replace('/login?reason=no-access');
        }
        return;
      }
      if (membership.tenantId !== getTenantId()) setTenantId(membership.tenantId);
      setState({ status: 'ready', me, membership });
    };

    const cached = getCachedMe();
    if (cached) apply(cached);

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
          goToLogin();
          return;
        }
        if (!cached) setState({ status: 'error', error: err });
      });
    return () => controller.abort();
    // `pathname` is intentionally not a dependency: the gate checks once per area mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, attempt]);

  useEffect(() => {
    const onUnauthorized = () => {
      void clearSession().then(goToLogin);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [goToLogin]);

  const value = useMemo<SessionValue | null>(() => {
    if (state.status !== 'ready') return null;
    const roles = AREA_ROLES[area];
    return {
      me: state.me,
      membership: state.membership,
      memberships: state.me.memberships.filter((m) => roles.includes(m.role)),
      switchTenant: (tenantId: string) => {
        const next = state.me.memberships.find(
          (m) => m.tenantId === tenantId && roles.includes(m.role),
        );
        if (!next) return;
        setTenantId(next.tenantId);
        setState({ status: 'ready', me: state.me, membership: next });
      },
      logout: async () => {
        await clearSession();
        setState({ status: 'redirecting' });
        router.replace('/login');
      },
    };
  }, [state, area, router]);

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

  if (!value) {
    return (
      <main className="page-x mx-auto max-w-xl py-10" aria-busy="true">
        <LoadingBlock />
      </main>
    );
  }

  if (value.membership.tenantStatus === 'suspended') {
    return <SuspendedNotice session={value} />;
  }

  return (
    <SessionContext.Provider value={value}>
      {/* Remount the area when the tenant changes so every screen refetches its data. */}
      <div key={value.membership.tenantId} className="contents">
        {children}
      </div>
    </SessionContext.Provider>
  );
}

/** A suspended operator: nothing works until the platform reactivates the account. */
function SuspendedNotice({ session }: { session: SessionValue }) {
  const others = session.memberships.filter(
    (m) => m.tenantId !== session.membership.tenantId && m.tenantStatus !== 'suspended',
  );
  return (
    <main className="page-x mx-auto flex max-w-xl flex-col gap-4 py-10">
      <Alert tone="error" title={`Contul ${session.membership.tenantName} este suspendat`}>
        {session.membership.role === 'affiliate'
          ? 'Operatorul nu primește rezervări momentan. Reîncearcă mai târziu.'
          : 'Administrarea și paginile de rezervare sunt oprite. Scrie-ne ca să reactivăm contul; datele tale sunt păstrate.'}
      </Alert>
      {others.map((m) => (
        <Button
          key={m.tenantId}
          variant="secondary"
          onClick={() => session.switchTenant(m.tenantId)}
        >
          Mergi la {m.tenantName}
        </Button>
      ))}
      <Button variant="ghost" onClick={() => void session.logout()}>
        Ieși din cont
      </Button>
    </main>
  );
}
