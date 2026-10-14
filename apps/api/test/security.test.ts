import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { type Harness, databaseUrl, startHarness } from './harness';

/** Abuse limits on the public routes, security headers and production-only configuration checks. */
describe.skipIf(!databaseUrl)('security hardening (needs TEST_DATABASE_URL)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-07-01T08:00:00Z', { RATE_LIMITS: 'on' });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('sends security headers on every API response', async () => {
    const response = await h.http.get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('stops one connection from requesting login codes for many phone numbers', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const response = await h.http
        .post('/auth/otp/request')
        .send({ destination: `+4072200${String(i).padStart(4, '0')}` });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 204)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('answers the limit in the language of the request, with Retry-After', async () => {
    const response = await h.http
      .post('/auth/otp/request')
      .set('accept-language', 'ro')
      .send({ destination: '+40722999999' });
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('errors.limits.tooManyRequests');
    expect(response.body.message).toContain('prea multe încercări');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('caps login codes for one account per day, not only per hour', async () => {
    const destination = 'daily@limit.test';
    const statuses: number[] = [];
    for (let hour = 0; hour < 3; hour += 1) {
      h.clock.set(`2026-07-02T${String(8 + hour * 2).padStart(2, '0')}:00:00Z`);
      for (let i = 0; i < 5; i += 1) {
        const response = await h.http
          .post('/auth/otp/request')
          .set('x-forwarded-for', `203.0.113.${hour * 10 + i}`)
          .send({ destination });
        statuses.push(response.status);
      }
    }
    // 5 in the first window, 5 in the second, then the daily cap of 10 is reached.
    expect(statuses.filter((s) => s === 204)).toHaveLength(10);
    expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
  });
});

describe('production configuration', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://localhost/db',
    PAYMENTS_PROVIDER: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    EMAIL_PROVIDER: 'disabled',
    SMS_PROVIDER: 'disabled',
  };

  it('needs a long APP_SECRET', () => {
    expect(() => loadConfig({ ...base, APP_SECRET: 'sixteen-chars-xx' })).toThrow(/APP_SECRET/);
    expect(() => loadConfig({ ...base, APP_SECRET: 'x'.repeat(32) })).not.toThrow();
  });

  it('does not allow turning rate limits off', () => {
    expect(() => loadConfig({ ...base, APP_SECRET: 'x'.repeat(32), RATE_LIMITS: 'off' })).toThrow(
      /rate limits/,
    );
  });
});
