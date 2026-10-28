import type { MeDto, MembershipDto, Role } from '@ap/contracts';
import {
  STORAGE_KEYS,
  clearAppStorage,
  readJson,
  readString,
  writeJson,
  writeString,
} from './storage';
import type { Translator } from './i18n';

export type Area = 'affiliate' | 'operator' | 'scanner';

export const AREA_ROLES: Record<Area, readonly Role[]> = {
  affiliate: ['affiliate'],
  operator: ['owner', 'staff'],
  // Operator staff can open the bare scanner too (e.g. on a phone left at the pier).
  scanner: ['scanner', 'owner', 'staff'],
};

const AREA_HOME: Record<Area, '/a' | '/o' | '/s'> = {
  affiliate: '/a',
  operator: '/o',
  scanner: '/s',
};

export function areaForRole(role: Role): Area {
  if (role === 'affiliate') return 'affiliate';
  if (role === 'scanner') return 'scanner';
  return 'operator';
}

export function homePathForRole(role: Role): '/a' | '/o' | '/s' {
  return AREA_HOME[areaForRole(role)];
}

/** The signed-in area a path belongs to, or null for public pages. */
export function areaForPath(path: string): Area | null {
  const match = (Object.entries(AREA_HOME) as [Area, string][]).find(
    ([, home]) => path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}?`),
  );
  return match?.[0] ?? null;
}

export function getToken(): string | null {
  return readString(STORAGE_KEYS.token);
}

/**
 * The company this tab works for. Kept per tab so that switching company in one tab does not
 * silently change the company another open tab sends its requests to; localStorage only holds
 * the last choice, used as the default for new tabs.
 */
let tabTenantId: string | null = null;

function readTabTenant(): string | null {
  try {
    return typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(STORAGE_KEYS.tenantId);
  } catch {
    return null;
  }
}

function writeTabTenant(tenantId: string | null): void {
  tabTenantId = tenantId;
  try {
    if (typeof window === 'undefined') return;
    if (tenantId) window.sessionStorage.setItem(STORAGE_KEYS.tenantId, tenantId);
    else window.sessionStorage.removeItem(STORAGE_KEYS.tenantId);
  } catch {
    // sessionStorage blocked: the module variable still keeps the tab's choice.
  }
}

export function getTenantId(): string | null {
  const own = tabTenantId ?? readTabTenant();
  if (own) return own;
  // A new tab starts from the last company chosen anywhere, then keeps it as its own, so a later
  // switch in another tab does not move this one.
  const fallback = readString(STORAGE_KEYS.tenantId);
  if (fallback) writeTabTenant(fallback);
  return fallback;
}

export function setTenantId(tenantId: string): void {
  writeTabTenant(tenantId);
  writeString(STORAGE_KEYS.tenantId, tenantId);
}

export function getCachedMe(): MeDto | null {
  return readJson<MeDto>(STORAGE_KEYS.me);
}

export function setCachedMe(me: MeDto): void {
  writeJson(STORAGE_KEYS.me, me);
}

/**
 * Stores a fresh login. Signing in over another person's session (e.g. `/login?next=…` skips the
 * account chooser) must not leave their cached data behind, so it is all cleared first:
 * affiliate home, profile, chosen company and the service worker's API cache.
 */
export async function saveSession(token: string, me: MeDto): Promise<void> {
  const previous = getCachedMe();
  if ((getToken() || previous) && previous?.user.id !== me.user.id) await clearSession();
  writeString(STORAGE_KEYS.token, token);
  setCachedMe(me);
}

/** Keeps the profile, swaps the token (after the other devices were signed out). */
export function replaceToken(token: string): void {
  writeString(STORAGE_KEYS.token, token);
}

/** Where "back" goes from the account page: the area the person last used. */
export function homePathFor(me: MeDto | null): string {
  if (!me) return '/login';
  const tenantId = getTenantId();
  const membership =
    me.memberships.find((m) => m.tenantId === tenantId) ?? me.memberships[0] ?? null;
  if (membership) return homePathForRole(membership.role);
  return me.user.isPlatformAdmin ? '/admin' : '/login';
}

/** Forgets the session and every cached response (localStorage and service worker cache). */
export async function clearSession(): Promise<void> {
  clearAppStorage();
  writeTabTenant(null);
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('ap-api')).map((n) => caches.delete(n)));
    }
  } catch {
    // Cache Storage unavailable: nothing to clear.
  }
}

/**
 * Chooses the membership to use in an area: the stored tenant if it has a fitting role there,
 * otherwise the first membership with a fitting role.
 */
export function pickMembership(
  memberships: MembershipDto[],
  area: Area,
  preferredTenantId: string | null,
): MembershipDto | null {
  const roles = AREA_ROLES[area];
  const fitting = memberships.filter((m) => roles.includes(m.role));
  if (preferredTenantId) {
    const preferred = fitting.find((m) => m.tenantId === preferredTenantId);
    if (preferred) return preferred;
  }
  return fitting[0] ?? null;
}

/**
 * Only same-origin absolute paths are accepted as a post-login destination. Browsers drop tabs
 * and line breaks and read `\` as `/`, so `/\t/evil.com` would become `//evil.com`: such
 * characters are refused outright, and the result is the path as the browser resolves it.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  // eslint-disable-next-line no-control-regex
  if (!next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return null;
  const base = 'https://app.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  return url.pathname + url.search + url.hash;
}

/** "Administrator" / "Staff" / "Affiliate" / "Ticket scanning" in the page language. */
export const roleLabel = (t: Translator, role: Role): string => t.tk(`auth.role.${role}`);

/** What each area is called in the account chooser. */
export const areaLabel = (t: Translator, area: Area): string => t.tk(`auth.area.${area}`);
