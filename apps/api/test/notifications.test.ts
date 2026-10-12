import { notifications } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module';
import { DeliveryError } from '../src/notifications/transports/transport';
import { type Harness, databaseUrl, startHarness } from './harness';

/** Delivery queue: retries with backoff, permanent failures, idempotency and login codes. */
describe.skipIf(!databaseUrl)('notifications (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  const db = () => h.app.get(DB);
  const rowsFor = (to: string) =>
    db().select().from(notifications).where(eq(notifications.recipient, to));
  const invite = (to: string, dedupeKey?: string) =>
    h.notifications.enqueue(db(), {
      to,
      template: 'affiliate_invite',
      locale: 'ro',
      tenantId: h.tenantId,
      dedupeKey,
      params: { tenantName: 'Delta Boats', url: 'http://web.test/join/abc' },
    });

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
  });

  beforeEach(() => {
    h.messages.failNext = [];
  });

  afterAll(async () => {
    await h?.close();
  });

  it('sends queued messages through the channel that matches the recipient', async () => {
    await invite('+40722111222');
    await invite('ana@hotel.test');
    expect(await h.notifications.deliverDue()).toBe(2);
    expect(h.messages.last('+40722111222')).toMatchObject({
      channel: 'sms',
      text: 'Delta Boats te invita in reteaua lor de afiliati: recomanzi excursii si castigi comision. Activeaza contul: http://web.test/join/abc',
    });
    expect(h.messages.last('ana@hotel.test')).toMatchObject({
      channel: 'email',
      subject: 'Delta Boats te invită în rețeaua de afiliați',
    });
    const [row] = await rowsFor('ana@hotel.test');
    expect(row).toMatchObject({ status: 'sent', attempts: 1, provider: 'memory' });
    expect(row?.providerMessageId).toMatch(/^mem-/);
  });

  it('retries a temporary failure with backoff', async () => {
    h.messages.failNext = [new DeliveryError('provider is down', false)];
    await invite('+40722000100');
    expect(await h.notifications.deliverDue()).toBe(0);
    let [row] = await rowsFor('+40722000100');
    expect(row).toMatchObject({ status: 'queued', attempts: 1, lastError: 'provider is down' });
    expect(row!.nextAttemptAt.toISOString()).toBe('2026-10-05T08:00:30.000Z');

    // Not due yet.
    expect(await h.notifications.deliverDue()).toBe(0);
    h.clock.set('2026-10-05T08:00:31Z');
    expect(await h.notifications.deliverDue()).toBe(1);
    [row] = await rowsFor('+40722000100');
    expect(row).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
  });

  it('gives up at once on a permanent failure', async () => {
    h.messages.failNext = [new DeliveryError('invalid phone number', true)];
    await invite('+40722000200');
    await h.notifications.deliverDue();
    const [row] = await rowsFor('+40722000200');
    expect(row).toMatchObject({ status: 'failed', attempts: 1, lastError: 'invalid phone number' });
    expect(h.messages.last('+40722000200')).toBeUndefined();
  });

  it('gives up after the last attempt', async () => {
    h.messages.failNext = Array.from({ length: 6 }, () => new DeliveryError('timeout', false));
    await invite('+40722000300');
    for (let i = 0; i < 6; i += 1) {
      await h.notifications.deliverDue();
      h.clock.set(new Date(h.clock.now().getTime() + 3 * 3_600_000).toISOString());
    }
    const [row] = await rowsFor('+40722000300');
    expect(row).toMatchObject({ status: 'failed', attempts: 6 });
    expect(await h.notifications.deliverDue()).toBe(0);
  });

  it('enqueues a message once per dedupe key', async () => {
    await invite('+40722000400', 'invite:once');
    await invite('+40722000400', 'invite:once');
    await h.notifications.deliverDue();
    expect(await rowsFor('+40722000400')).toHaveLength(1);
    expect(h.messages.sent.filter((m) => m.to === '+40722000400')).toHaveLength(1);
  });

  it('sends login codes at once and never stores them', async () => {
    await h.http.post('/auth/otp/request').send({ destination: '+40722000500' }).expect(204);
    const sms = h.messages.last('+40722000500');
    const code = /(\d{6})/.exec(sms?.text ?? '')?.[1];
    expect(code).toBeDefined();
    expect(sms?.text).toContain(`@web.test #${code}`);
    const [row] = await rowsFor('+40722000500');
    expect(row).toMatchObject({ status: 'sent', template: 'login_code', params: {} });
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it('tells the user when a login code cannot be sent', async () => {
    h.messages.failNext = [new DeliveryError('provider is down', false)];
    const down = await h.http
      .post('/auth/otp/request')
      .send({ destination: '+40722000600' })
      .expect(503);
    expect(down.body.message).toContain('try again');

    h.messages.failNext = [new DeliveryError('not a mobile number', true)];
    const wrong = await h.http
      .post('/auth/otp/request')
      .send({ destination: '+40212000600' })
      .expect(400);
    expect(wrong.body.message).toContain('check that it is correct');
    const [row] = await rowsFor('+40212000600');
    expect(row).toMatchObject({ status: 'failed', lastError: 'not a mobile number' });
  });
});
