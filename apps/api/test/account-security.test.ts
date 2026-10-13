import type {
  AccountSecurityDto,
  CheckInResultDto,
  CheckoutResultDto,
  MeDto,
  MfaChallengeDto,
  ProductDto,
  SessionDto,
  SlotDto,
  TwoFactorEnabledDto,
  TwoFactorSetupDto,
} from '@ap/contracts';
import { createDb, memberships, users } from '@ap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardsAround } from '../src/booking/tickets.service';
import { isPlatformAdmin } from '../src/common/auth';
import { totpCode, totpStep } from '../src/common/crypto';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The person's own account: signing out other devices, optional two-step login with an
 * authenticator app and recovery codes, adding a phone or email; plus the owner-only money
 * screens and tickets scanned on the wrong day.
 */
describe.skipIf(!databaseUrl)('account security (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  const authed = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`);
  const inTenant = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    authed(token, method, path).set('x-tenant-id', h.tenantId);
  const tick = (seconds: number) =>
    h.clock.set(new Date(h.clock.now().getTime() + seconds * 1000).toISOString());
  const codeNow = (secret: string) => totpCode(secret, totpStep(h.clock.now().getTime()));

  async function firstStep(destination: string): Promise<SessionDto | MfaChallengeDto> {
    await h.http.post('/auth/otp/request').send({ destination }).expect(204);
    const code = /(\d{6})/.exec(h.messages.last(destination)?.text ?? '')?.[1];
    return (await h.http.post('/auth/otp/verify').send({ destination, code }).expect(200)).body as
      SessionDto | MfaChallengeDto;
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('signs out every other device and keeps this one', async () => {
    const phone = await signIn(h, h.ownerEmail);
    const laptop = await signIn(h, h.ownerEmail);
    const fresh = (await authed(laptop, 'post', '/account/sessions/sign-out-others').expect(200))
      .body.token as string;
    await authed(phone, 'get', '/me').expect(401);
    await authed(laptop, 'get', '/me').expect(401);
    await authed(fresh, 'get', '/me').expect(200);
  });

  describe('two-step login', () => {
    const email = 'two-step@delta.test';
    let token: string;
    let secret: string;
    let recovery: string[];

    it('is off until the person turns it on', async () => {
      token = await signIn(h, email);
      const security = (await authed(token, 'get', '/account/security').expect(200))
        .body as AccountSecurityDto;
      expect(security).toMatchObject({ email, twoFactorEnabled: false, recoveryCodesLeft: 0 });
    });

    it('turns on with the first code from the app, and signs out the other devices', async () => {
      const other = await signIn(h, email);
      const setup = (await authed(token, 'post', '/account/2fa/setup').expect(200))
        .body as TwoFactorSetupDto;
      secret = setup.secret;
      expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/);

      await authed(token, 'post', '/account/2fa/enable').send({ code: '000000' }).expect(422);
      const enabled = (
        await authed(token, 'post', '/account/2fa/enable')
          .send({ code: codeNow(secret) })
          .expect(200)
      ).body as TwoFactorEnabledDto;
      recovery = enabled.recoveryCodes;
      expect(recovery).toHaveLength(10);
      await authed(other, 'get', '/me').expect(401);
      await authed(token, 'get', '/me').expect(401);
      token = enabled.token;
      const me = (await authed(token, 'get', '/me').expect(200)).body as MeDto;
      expect(me.user.twoFactorEnabled).toBe(true);

      // The person's inbox is told, in case it was not them.
      const alert = await h.lastMessage(email);
      expect(alert?.subject).toContain('Two-step login is on');
    });

    it('asks for the app code after the SMS/email code', async () => {
      const first = await firstStep(email);
      expect(first).toMatchObject({ mfaRequired: true });
      expect('token' in first).toBe(false);
      const { mfaToken } = first as MfaChallengeDto;

      // The code used to turn it on cannot be used again.
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken, code: codeNow(secret) })
        .expect(422);
      tick(30);
      const session = (
        await h.http
          .post('/auth/mfa/verify')
          .send({ mfaToken, code: codeNow(secret) })
          .expect(200)
      ).body as SessionDto;
      await authed(session.token, 'get', '/me').expect(200);
      // ...and neither can this one.
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken, code: codeNow(secret) })
        .expect(422);
    });

    it('refuses the challenge as a session and expires it', async () => {
      const { mfaToken } = (await firstStep(email)) as MfaChallengeDto;
      await authed(mfaToken, 'get', '/me').expect(401);
      tick(11 * 60);
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken, code: codeNow(secret) })
        .expect(401);
    });

    it('accepts each recovery code once', async () => {
      tick(61 * 60); // a new hour of login codes
      const { mfaToken } = (await firstStep(email)) as MfaChallengeDto;
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken, code: recovery[0]!.toLowerCase() })
        .expect(200);
      await h.http.post('/auth/mfa/verify').send({ mfaToken, code: recovery[0] }).expect(422);
      const login = (await firstStep(email)) as MfaChallengeDto;
      const session = (
        await h.http.post('/auth/mfa/verify').send({ mfaToken: login.mfaToken, code: recovery[1] })
      ).body as SessionDto;
      token = session.token;
      const security = (await authed(token, 'get', '/account/security').expect(200))
        .body as AccountSecurityDto;
      expect(security.recoveryCodesLeft).toBe(8);
    });

    it('locks the second step after 5 wrong codes in a row', async () => {
      tick(61 * 60);
      const { mfaToken } = (await firstStep(email)) as MfaChallengeDto;
      for (let i = 0; i < 4; i += 1) {
        await h.http.post('/auth/mfa/verify').send({ mfaToken, code: '111111' }).expect(422);
      }
      await h.http.post('/auth/mfa/verify').send({ mfaToken, code: '111111' }).expect(429);
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken, code: codeNow(secret) })
        .expect(429);
      tick(16 * 60);
      const again = (await firstStep(email)) as MfaChallengeDto;
      await h.http
        .post('/auth/mfa/verify')
        .send({ mfaToken: again.mfaToken, code: codeNow(secret) })
        .expect(200);
    });

    it('turns off only with a code, not with the open session alone', async () => {
      tick(61 * 60);
      await authed(token, 'post', '/account/2fa/disable').send({ code: '222222' }).expect(422);
      await authed(token, 'post', '/account/2fa/disable')
        .send({ code: codeNow(secret) })
        .expect(200);
      const first = await firstStep(email);
      expect('token' in first && first.token).toBeTruthy();
      expect((await h.lastMessage(email))?.subject).toBe('Two-step login was turned off');
    });
  });

  describe('phone number and email', () => {
    const phone = '+40722111222';
    let token: string;

    it('adds an email to a phone account once the code from the inbox confirms it', async () => {
      token = await signIn(h, phone);
      const newEmail = 'new-inbox@delta.test';
      await authed(token, 'post', '/account/contact/request')
        .send({ destination: newEmail })
        .expect(204);
      await authed(token, 'post', '/account/contact/verify')
        .send({ destination: newEmail, code: '000000' })
        .expect(401);
      const code = /(\d{6})/.exec(h.messages.last(newEmail)?.text ?? '')?.[1];
      const me = (
        await authed(token, 'post', '/account/contact/verify')
          .send({ destination: newEmail, code })
          .expect(200)
      ).body as MeDto;
      expect(me.user).toMatchObject({ phone, email: newEmail });

      // The phone it already had is told.
      const alert = await h.lastMessage(phone);
      expect(alert?.text).toContain('ne***@delta.test');

      // Signing in with the new email reaches the same account.
      const byEmail = await signIn(h, newEmail);
      const again = (await authed(byEmail, 'get', '/me').expect(200)).body as MeDto;
      expect(again.user.id).toBe(me.user.id);
    });

    it('refuses a phone or email that belongs to someone else', async () => {
      await authed(token, 'post', '/account/contact/request')
        .send({ destination: h.ownerEmail })
        .expect(409);
    });
  });

  describe('owner-only money screens', () => {
    let staff: string;

    beforeAll(async () => {
      const db = createDb(databaseUrl!, { max: 1 });
      const [user] = await db.db.insert(users).values({ email: 'staff@delta.test' }).returning();
      await db.db
        .insert(memberships)
        .values({ userId: user!.id, tenantId: h.tenantId, role: 'staff' });
      await db.close();
      staff = await signIn(h, 'staff@delta.test');
    });

    it('lets staff invite affiliates but not set what they earn', async () => {
      await inTenant(staff, 'post', '/operator/affiliates')
        .send({ displayName: 'Hotel Delta', type: 'person' })
        .expect(201);
      await inTenant(staff, 'post', '/operator/affiliates')
        .send({ displayName: 'Hotel Lux', type: 'person', commissionRateBpsOverride: 5000 })
        .expect(403);
    });

    it('keeps commission plans and payouts to the owner', async () => {
      await inTenant(staff, 'post', '/operator/commission-plans')
        .send({ name: 'Generous', kind: 'fixed', rateBps: 9000 })
        .expect(403);
      await inTenant(staff, 'post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-09' })
        .expect(403);
      await inTenant(staff, 'get', '/operator/commission-plans').expect(200);
    });
  });

  describe('tickets for another day', () => {
    let owner: string;
    let booking: CheckoutResultDto;
    let qrToken: string;

    beforeAll(async () => {
      owner = await signIn(h, h.ownerEmail);
      const product = (
        await inTenant(owner, 'post', '/operator/products')
          .send({
            name: 'Apus',
            slug: 'apus',
            durationMinutes: 60,
            prices: [{ code: 'adult', label: 'Adult', amountMinor: 5_000, taxRateBps: 0 }],
          })
          .expect(201)
      ).body as ProductDto;
      await inTenant(owner, 'post', `/operator/products/${product.id}/slots`)
        .send({ fromDate: '2026-10-20', toDate: '2026-10-20', times: ['18:00'], capacity: 10 })
        .expect(201);
      const [slot] = (
        await h.http
          .get('/public/tenants/delta-boats/products/apus/slots?from=2026-10-20&to=2026-10-20')
          .expect(200)
      ).body as SlotDto[];
      booking = (
        await h.http
          .post('/public/tenants/delta-boats/checkout')
          .send({
            slotId: slot!.id,
            items: [{ priceId: product.prices[0]!.id, quantity: 1 }],
            acceptTerms: true,
            customer: { name: 'Ana', email: 'ana@example.com', locale: 'ro' },
          })
          .expect(201)
      ).body as CheckoutResultDto;
      const key = new URL(booking.ticketUrl).searchParams.get('k')!;
      await h.http.post(`/public/dev-payments/${booking.booking.id}/succeed?k=${key}`).expect(204);
      await h.outbox.drain();
      qrToken = (await h.http.get(`/public/tickets/${booking.booking.id}?k=${key}`).expect(200))
        .body.qrToken as string;
    });

    it('does not use up a ticket scanned on the wrong day', async () => {
      h.clock.set('2026-10-19T15:00:00Z');
      const early = (
        await inTenant(owner, 'post', '/operator/tickets/check-in')
          .send({ token: qrToken })
          .expect(200)
      ).body as CheckInResultDto;
      expect(early.result).toBe('wrong_day');
      expect(early.checkedInAt).toBeNull();
      expect(early.ticket?.status).toBe('valid');
    });

    it('boards it anyway when the scanner confirms', async () => {
      const boarded = (
        await inTenant(owner, 'post', '/operator/tickets/check-in')
          .send({ token: qrToken, allowOtherDay: true })
          .expect(200)
      ).body as CheckInResultDto;
      expect(boarded.result).toBe('checked_in');
    });

    it('treats the same local day, and a few hours either side, as the right day', () => {
      const departure = new Date('2026-10-20T21:30:00Z'); // 00:30 on the 21st in Bucharest
      const tz = 'Europe/Bucharest';
      expect(boardsAround(departure, new Date('2026-10-20T19:45:00Z'), tz)).toBe(true);
      expect(boardsAround(departure, new Date('2026-10-21T05:00:00Z'), tz)).toBe(true);
      expect(boardsAround(departure, new Date('2026-10-20T10:00:00Z'), tz)).toBe(false);
      expect(boardsAround(departure, new Date('2026-10-22T08:00:00Z'), tz)).toBe(false);
    });
  });

  it('takes platform admin rights away as soon as the email leaves PLATFORM_ADMIN_EMAILS', () => {
    const admin = { email: 'boss@platform.test', isPlatformAdmin: true };
    expect(isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: ['boss@platform.test'] }, admin)).toBe(true);
    expect(isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: ['new@platform.test'] }, admin)).toBe(false);
    expect(isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: [] }, admin)).toBe(true);
    expect(
      isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: [] }, { ...admin, isPlatformAdmin: false }),
    ).toBe(false);
  });
});
