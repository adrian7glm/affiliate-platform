import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, buildUrl, UNAUTHORIZED_EVENT } from './api';
import { STORAGE_KEYS } from './storage';

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildUrl', () => {
  it('skips empty query values', () => {
    expect(buildUrl('https://api.test', '/x', { from: '2026-10-01', to: undefined, q: '' })).toBe(
      'https://api.test/x?from=2026-10-01',
    );
    expect(buildUrl('https://api.test', 'y')).toBe('https://api.test/y');
  });
});

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(STORAGE_KEYS.token, 'tok-123');
    localStorage.setItem(STORAGE_KEYS.tenantId, 'tenant-1');
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends the bearer token, tenant header and JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const result = await apiFetch<{ ok: boolean }>('/operator/affiliates', {
      method: 'POST',
      body: { displayName: 'Ana' },
      baseUrl: 'https://api.test',
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/operator/affiliates');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers['X-Tenant-Id']).toBe('tenant-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ displayName: 'Ana' }));
  });

  it('omits credentials on public calls', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await apiFetch('/public/tenants/x', { auth: false, baseUrl: 'https://api.test' });
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-Tenant-Id']).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      apiFetch('/auth/otp/request', { method: 'POST', body: {}, auth: false }),
    ).resolves.toBeUndefined();
  });

  it('throws a typed error with the API message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { statusCode: 409, error: 'Conflict', message: 'Not enough seats left' }),
    );
    const error = await apiFetch('/affiliate/bookings', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe('Conflict');
    expect((error as ApiError).message).toBe('Not enough seats left');
  });

  it('reports network failures as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = (await apiFetch('/me').catch((e: unknown) => e)) as ApiError;
    expect(error.isNetwork).toBe(true);
  });

  it('announces an expired session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' }),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    await apiFetch('/me').catch(() => undefined);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
