import type { MeDto } from '@ap/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';
import { clearSession, getTenantId, safeNextPath, saveSession, setTenantId } from './session';
import { STORAGE_KEYS } from './storage';

function me(id: string): MeDto {
  return { user: { id } as MeDto['user'], memberships: [] };
}

afterEach(async () => {
  await clearSession();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('safeNextPath', () => {
  it('keeps local paths, normalised', () => {
    expect(safeNextPath('/a/qr')).toBe('/a/qr');
    expect(safeNextPath('/o/bookings?status=paid#top')).toBe('/o/bookings?status=paid#top');
    expect(safeNextPath('/a/../o')).toBe('/o');
  });

  it('refuses anything a browser could resolve to another site', () => {
    for (const next of [
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/\t\\evil.com',
      '/a\u0000',
      '/a\u007f',
      'https://evil.com',
      'evil.com',
    ]) {
      expect(safeNextPath(next), JSON.stringify(next)).toBeNull();
    }
  });

  it('refuses a tab smuggled in through the login link', () => {
    const next = new URL('https://app.test/login?next=%2F%09%2Fevil.com').searchParams.get('next');
    expect(safeNextPath(next)).toBeNull();
  });
});

describe('active company per tab', () => {
  it('is not changed by another tab switching company', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(STORAGE_KEYS.token, 't');
    setTenantId('tenant-A');
    // Another tab picks a different company: it only changes the shared default.
    localStorage.setItem(STORAGE_KEYS.tenantId, 'tenant-B');

    expect(getTenantId()).toBe('tenant-A');
    await apiFetch('/operator/products', { method: 'POST', body: {} });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['X-Tenant-Id']).toBe('tenant-A');
  });

  it('defaults to the last company chosen in any tab', () => {
    localStorage.setItem(STORAGE_KEYS.tenantId, 'tenant-B');
    expect(getTenantId()).toBe('tenant-B');
  });

  it('keeps the inherited company when another tab switches later', () => {
    // A new tab starts on the shared default without anyone picking a company in it.
    localStorage.setItem(STORAGE_KEYS.tenantId, 'tenant-A');
    expect(getTenantId()).toBe('tenant-A');
    localStorage.setItem(STORAGE_KEYS.tenantId, 'tenant-B');
    expect(getTenantId()).toBe('tenant-A');
  });
});

describe('saveSession', () => {
  it("clears the previous person's cached data", async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['ap-api-v1', 'ap-static-v1'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });
    await saveSession('token-1', me('user-1'));
    setTenantId('tenant-1');
    localStorage.setItem(STORAGE_KEYS.affiliateHome('tenant-1'), '{"user":"one"}');

    await saveSession('token-2', me('user-2'));

    expect(localStorage.getItem(STORAGE_KEYS.affiliateHome('tenant-1'))).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.token)).toBe('token-2');
    expect(getTenantId()).toBeNull();
    expect(deleted).toEqual(['ap-api-v1']);
  });

  it('keeps the offline copies when the same person signs in again', async () => {
    await saveSession('token-1', me('user-1'));
    localStorage.setItem(STORAGE_KEYS.affiliateHome('tenant-1'), '{}');
    await saveSession('token-2', me('user-1'));
    expect(localStorage.getItem(STORAGE_KEYS.affiliateHome('tenant-1'))).toBe('{}');
  });
});
