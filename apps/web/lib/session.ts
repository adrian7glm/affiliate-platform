import type { MeDto, MembershipDto, Role } from '@ap/contracts';
import {
  STORAGE_KEYS,
  clearAppStorage,
  readJson,
  readString,
  writeJson,
  writeString,
} from './storage';

export type Area = 'affiliate' | 'operator';

export const AREA_ROLES: Record<Area, readonly Role[]> = {
  affiliate: ['affiliate'],
  operator: ['owner', 'staff'],
};

export function areaForRole(role: Role): Area {
  return role === 'affiliate' ? 'affiliate' : 'operator';
}

export function homePathForRole(role: Role): '/a' | '/o' {
  return role === 'affiliate' ? '/a' : '/o';
}

export function getToken(): string | null {
  return readString(STORAGE_KEYS.token);
}

export function getTenantId(): string | null {
  return readString(STORAGE_KEYS.tenantId);
}

export function setTenantId(tenantId: string): void {
  writeString(STORAGE_KEYS.tenantId, tenantId);
}

export function getCachedMe(): MeDto | null {
  return readJson<MeDto>(STORAGE_KEYS.me);
}

export function setCachedMe(me: MeDto): void {
  writeJson(STORAGE_KEYS.me, me);
}

export function saveSession(token: string, me: MeDto): void {
  writeString(STORAGE_KEYS.token, token);
  setCachedMe(me);
}

/** Forgets the session and every cached response (localStorage and service worker cache). */
export async function clearSession(): Promise<void> {
  clearAppStorage();
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

/** Only same-origin absolute paths are accepted as a post-login destination. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
}

export const ROLE_LABELS_RO: Record<Role, string> = {
  owner: 'Administrator',
  staff: 'Personal',
  affiliate: 'Afiliat',
};
