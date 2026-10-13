/**
 * localStorage helpers. Every access is wrapped in try/catch: storage can be unavailable
 * (private mode, blocked site data, server rendering) and the app must keep working without it.
 */

export const STORAGE_KEYS = {
  token: 'ap.token',
  tenantId: 'ap.tenantId',
  me: 'ap.me',
  affiliateHome: (tenantId: string) => `ap.affiliateHome.${tenantId}`,
} as const;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota exceeded or storage blocked: the value just is not persisted.
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Ignore.
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readString(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Ignore values that cannot be serialized.
  }
}

/** Removes every key written by this app (logout). */
export function clearAppStorage(): void {
  try {
    const s = storage();
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      // The language choice outlives the session.
      if (k && k.startsWith('ap.') && k !== 'ap.lang') keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    // Ignore.
  }
}
