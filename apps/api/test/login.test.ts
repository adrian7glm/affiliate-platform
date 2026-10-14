import type { AuthOptionsDto, PlatformSettingsDto, SessionDto } from '@ap/contracts';
import { users } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/common/crypto';
import { DB } from '../src/database/database.module';
import { DEMO_PASSWORD } from '../src/identity/demo-accounts';
import { GoogleClient } from '../src/identity/google.client';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * Ways to sign in besides a code: email + password (set with an emailed code), Google, the SMS
 * switch in the admin area and the demo accounts listed while DEMO_MODE is on.
 */
describe.skipIf(!databaseUrl)('sign-in methods (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  const adminEmail = 'adrian@platform.test';

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', {
      PLATFORM_ADMIN_EMAILS: adminEmail,
      SMS_LOGIN: 'false',
      GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      API_URL: 'http://api.test',
      DEMO_MODE: 'true',
    });
    // Keep one listening server: supertest's start/stop per request trips over fast replies.
    await h.app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.close();
  });

  async function emailCode(email: string): Promise<string> {
    await h.http.post('/auth/otp/request').send({ destination: email }).expect(204);
    const code = /(\d{6})/.exec(h.messages.last(email)?.text ?? '')?.[1];
    if (!code) throw new Error(`no code sent to ${email}`);
    return code;
  }

  it('sets a password with an emailed code, then signs in with it', async () => {
    const email = 'maria@hotel.test';
    const code = await emailCode(email);
    await h.http.post('/auth/password/reset').send({ email, code, password: 'short' }).expect(400);
    const reset = await h.http
      .post('/auth/password/reset')
      .send({ email, code, password: 'marea-neagra-2026' })
      .expect(200);
    expect((reset.body as SessionDto).token).toBeTruthy();

    const login = await h.http
      .post('/auth/password/login')
      .send({ email: 'Maria@Hotel.test', password: 'marea-neagra-2026' })
      .expect(200);
    expect((login.body as SessionDto).user.email).toBe(email);

    const wrong = await h.http
      .post('/auth/password/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    expect(wrong.body.code).toBe('errors.auth.wrongPassword');
    // A used code cannot set the password again.
    await h.http
      .post('/auth/password/reset')
      .send({ email, code, password: 'another-password' })
      .expect(401);
  });

  it('answers the same for an unknown email and stops guessing after 10 wrong passwords', async () => {
    const unknown = await h.http
      .post('/auth/password/login')
      .send({ email: 'nobody@nowhere.test', password: 'whatever1' })
      .expect(401);
    expect(unknown.body.code).toBe('errors.auth.wrongPassword');

    const email = 'guessed@hotel.test';
    await h.http
      .post('/auth/password/reset')
      .send({ email, code: await emailCode(email), password: 'correct-horse' })
      .expect(200);
    for (let i = 0; i < 10; i += 1) {
      await h.http
        .post('/auth/password/login')
        .send({ email, password: `nope-${i}` })
        .expect(401);
    }
    const blocked = await h.http
      .post('/auth/password/login')
      .send({ email, password: 'correct-horse' })
      .expect(429);
    expect(blocked.body.code).toBe('errors.auth.tooManyAttempts');
    h.clock.set('2026-10-05T08:16:00Z');
    await h.http
      .post('/auth/password/login')
      .send({ email, password: 'correct-horse' })
      .expect(200);
  });

  it('turns SMS codes on and off from the admin area', async () => {
    const off = await h.http.post('/auth/otp/request').send({ destination: '+40722000900' });
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('errors.auth.smsOff');
    expect(((await h.http.get('/auth/options').expect(200)).body as AuthOptionsDto).sms).toBe(
      false,
    );

    const admin = await signIn(h, adminEmail);
    const owner = await signIn(h, h.ownerEmail);
    await h.http
      .patch('/admin/settings')
      .set('authorization', `Bearer ${owner}`)
      .send({ smsLogin: true })
      .expect(403);
    const settings = await h.http
      .patch('/admin/settings')
      .set('authorization', `Bearer ${admin}`)
      .send({ smsLogin: true })
      .expect(200);
    expect(settings.body as PlatformSettingsDto).toEqual({
      smsLogin: true,
      smsAvailable: true,
      googleLogin: true,
      demoMode: true,
    });
    expect(((await h.http.get('/auth/options').expect(200)).body as AuthOptionsDto).sms).toBe(true);
    await signIn(h, '+40722000900');
  });

  it('lists the demo accounts that exist while DEMO_MODE is on', async () => {
    const db = h.app.get(DB);
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await db
      .insert(users)
      .values({ email: 'owner@demo.test', name: 'Operator Demo', passwordHash });
    const options = (await h.http.get('/auth/options').expect(200)).body as AuthOptionsDto;
    expect(options.google).toBe(true);
    expect(options.demoAccounts).toEqual([
      { role: 'owner', name: 'Operator Demo', email: 'owner@demo.test', password: DEMO_PASSWORD },
    ]);
    await h.http
      .post('/auth/password/login')
      .send({ email: 'owner@demo.test', password: DEMO_PASSWORD })
      .expect(200);
  });

  it('signs in with Google and links the account by email', async () => {
    const profile = vi.spyOn(GoogleClient.prototype, 'profile').mockResolvedValue({
      sub: 'google-123',
      email: 'maria@hotel.test',
      emailVerified: true,
      name: 'Maria',
    });

    const start = await h.http.get('/auth/google/start?next=%2Fa').expect(302);
    const google = new URL(start.headers.location as string);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe('http://api.test/auth/google/callback');
    const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const state = google.searchParams.get('state')!;

    // Without the cookie of the browser that started, the answer is refused.
    const stranger = await h.http
      .get(`/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .expect(302);
    expect(stranger.headers.location).toBe('http://web.test/login#google_error=expired');

    const back = await h.http
      .get(`/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .set('cookie', cookie)
      .expect(302);
    const fragment = new URLSearchParams((back.headers.location as string).split('#')[1]);
    expect(fragment.get('next')).toBe('/a');
    const session = await h.http
      .post('/auth/handoff')
      .send({ token: fragment.get('handoff') })
      .expect(200);
    expect((session.body as SessionDto).user.email).toBe('maria@hotel.test');
    const [linked] = await h.app
      .get(DB)
      .select()
      .from(users)
      .where(eq(users.email, 'maria@hotel.test'));
    expect(linked?.googleSub).toBe('google-123');

    // An unverified Google email never matches an account.
    profile.mockResolvedValueOnce({
      sub: 'google-456',
      email: 'owner@delta.test',
      emailVerified: false,
      name: null,
    });
    const again = await h.http.get('/auth/google/start').expect(302);
    const unverified = await h.http
      .get(
        `/auth/google/callback?code=abc&state=${encodeURIComponent(new URL(again.headers.location as string).searchParams.get('state')!)}`,
      )
      .set('cookie', (again.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!)
      .expect(302);
    expect(unverified.headers.location).toBe('http://web.test/login#google_error=email');

    // Handoff tokens are short-lived.
    h.clock.set('2026-10-05T09:00:00Z');
    await h.http
      .post('/auth/handoff')
      .send({ token: fragment.get('handoff') })
      .expect(401);
  });
});
