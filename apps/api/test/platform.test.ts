import type {
  AdminOverviewDto,
  AdminTenantDetailDto,
  CheckoutResultDto,
  CreateTenantResultDto,
  MeDto,
  OperatorBillingDto,
  OperatorInviteDto,
  PlatformPlanDto,
  ProductDto,
  SlotDto,
  SubscriptionDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The platform owner's side: operators sign up or are invited, start a trial on a plan, the
 * platform fee follows the plan or a negotiated rate, and the owner sees every operator's
 * numbers, changes plans and suspends accounts.
 */
describe.skipIf(!databaseUrl)('platform admin and onboarding (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let admin: string;
  let founder: string;
  let plans: PlatformPlanDto[];
  let selfServe: CreateTenantResultDto;
  let invited: CreateTenantResultDto;
  let invite: OperatorInviteDto;
  const adminEmail = 'adrian@platform.test';
  const founderEmail = 'maria@lacul.test';
  const invitedEmail = 'ion@deltatours.test';

  const as = (token: string, method: 'get' | 'post' | 'patch', path: string, tenantId?: string) => {
    const req = h.http[method](path).set('authorization', `Bearer ${token}`);
    return tenantId ? req.set('x-tenant-id', tenantId) : req;
  };
  const plan = (code: string) => plans.find((p) => p.code === code)!;
  const fee = async (tenantId: string) =>
    (
      (await as(admin, 'get', `/admin/tenants/${tenantId}`).expect(200))
        .body as AdminTenantDetailDto
    ).subscription!.platformFeeBps;

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', {
      PLATFORM_ADMIN_EMAILS: `${adminEmail}, other@platform.test`,
    });
    admin = await signIn(h, adminEmail);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('opens the admin area only to the platform owner', async () => {
    const me = await as(admin, 'get', '/me').expect(200);
    expect((me.body as MeDto).user.isPlatformAdmin).toBe(true);

    const owner = await signIn(h, h.ownerEmail);
    await as(owner, 'get', '/admin/overview').expect(403);
    await h.http.get('/admin/overview').expect(401);

    const listed = await as(admin, 'get', '/admin/plans').expect(200);
    plans = listed.body as PlatformPlanDto[];
    expect(plans.map((p) => [p.code, p.monthlyPriceMinor, p.platformFeeBps, p.isDefault])).toEqual([
      ['start', 1900, 300, true],
      ['pro', 4900, 200, false],
    ]);
  });

  it('lets an operator sign up alone and start a free trial on the default plan', async () => {
    const options = await h.http.get('/signup/options').expect(200);
    expect(options.body.selfSignup).toBe(true);
    expect(options.body.plans).toHaveLength(2);

    await h.http
      .get('/signup/slug?slug=delta-boats')
      .expect(200)
      .expect((r) => {
        expect(r.body).toEqual({
          slug: 'delta-boats',
          available: false,
          suggestion: 'delta-boats-2',
        });
      });

    founder = await signIn(h, founderEmail);
    await h.http.post('/signup/tenants').send({ name: 'Lacul Albastru' }).expect(401);
    const created = await as(founder, 'post', '/signup/tenants')
      .send({ name: 'Plimbări pe Lacul Albastru', ownerName: 'Maria', currency: 'ron' })
      .expect(201);
    selfServe = created.body as CreateTenantResultDto;
    expect(selfServe.slug).toBe('plimbari-pe-lacul-albastru');

    const me = (await as(founder, 'get', '/me').expect(200)).body as MeDto;
    expect(me.user.name).toBe('Maria');
    expect(me.memberships).toEqual([
      expect.objectContaining({
        tenantId: selfServe.tenantId,
        role: 'owner',
        tenantStatus: 'active',
      }),
    ]);

    const billing = (await as(founder, 'get', '/operator/billing', selfServe.tenantId).expect(200))
      .body as OperatorBillingDto;
    expect(billing.provider).toBe('manual');
    expect(billing.subscription).toMatchObject({
      planName: 'Start',
      status: 'trialing',
      trialEndsAt: '2026-10-19T08:00:00.000Z',
      platformFeeBps: 300,
      monthlyPriceMinor: 1900,
    });

    const setup = await as(founder, 'get', '/operator/onboarding', selfServe.tenantId).expect(200);
    expect(setup.body).toMatchObject({ completed: 0, total: 5 });

    // A taken name gets the next free address.
    const again = await as(founder, 'post', '/signup/tenants')
      .send({ name: 'Plimbări pe Lacul Albastru' })
      .expect(201);
    expect(again.body.slug).toBe('plimbari-pe-lacul-albastru-2');
    await as(founder, 'post', '/signup/tenants')
      .send({ name: 'Altceva', slug: 'delta-boats' })
      .expect(409)
      .expect((r) => expect(r.body.details).toEqual({ suggestion: 'delta-boats-2' }));
  });

  it('invites an operator with a negotiated fee and a longer trial', async () => {
    const created = await as(admin, 'post', '/admin/invites')
      .send({
        email: invitedEmail,
        businessName: 'Delta Tours',
        planId: plan('pro').id,
        feeBpsOverride: 150,
        trialDays: 30,
      })
      .expect(201);
    invite = created.body as OperatorInviteDto;
    expect(invite.status).toBe('pending');
    const token = invite.inviteUrl!.split('/start/')[1]!;
    expect((await h.lastMessage(invitedEmail))?.text).toContain(invite.inviteUrl);

    await h.http
      .get(`/signup/invites/${token}`)
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({
          businessName: 'Delta Tours',
          trialDays: 30,
          platformFeeBps: 150,
          plan: { name: 'Pro' },
        }),
      );

    // The link only works for the invited address.
    await as(founder, 'post', '/signup/tenants')
      .send({ name: 'Delta Tours', inviteToken: token })
      .expect(403);

    const invitee = await signIn(h, invitedEmail);
    invited = (
      await as(invitee, 'post', '/signup/tenants')
        .send({ name: 'Delta Tours', inviteToken: token })
        .expect(201)
    ).body as CreateTenantResultDto;

    const detail = (await as(admin, 'get', `/admin/tenants/${invited.tenantId}`).expect(200))
      .body as AdminTenantDetailDto;
    expect(detail.ownerEmail).toBe(invitedEmail);
    expect(detail.subscription).toMatchObject({
      planName: 'Pro',
      status: 'trialing',
      trialEndsAt: '2026-11-04T08:00:00.000Z',
      platformFeeBps: 150,
      feeBpsOverride: 150,
    });
    expect(detail.audit.map((a) => a.action)).toContain('tenant.created');

    await as(invitee, 'post', '/signup/tenants')
      .send({ name: 'Delta Tours 2', inviteToken: token })
      .expect(410);
    const invites = (await as(admin, 'get', '/admin/invites').expect(200))
      .body as OperatorInviteDto[];
    expect(invites[0]).toMatchObject({
      status: 'accepted',
      tenantId: invited.tenantId,
      inviteUrl: null,
    });
  });

  it('applies a plan fee change to operators without a negotiated fee', async () => {
    await as(admin, 'patch', `/admin/plans/${plan('start').id}`)
      .send({ platformFeeBps: 400 })
      .expect(200)
      .expect((r) => expect(r.body.tenantCount).toBe(2));
    expect(await fee(selfServe.tenantId)).toBe(400);
    expect(await fee(invited.tenantId)).toBe(150);

    await as(admin, 'patch', `/admin/plans/${plan('start').id}`)
      .send({ isActive: false })
      .expect(422);
  });

  it('enforces the plan affiliate limit', async () => {
    await as(admin, 'patch', `/admin/plans/${plan('start').id}`)
      .send({ maxAffiliates: 1 })
      .expect(200);
    await as(founder, 'post', '/operator/affiliates', selfServe.tenantId)
      .send({ displayName: 'Hotel Central' })
      .expect(201);
    await as(founder, 'post', '/operator/affiliates', selfServe.tenantId)
      .send({ displayName: 'Pensiunea Lacului' })
      .expect(402);
  });

  it('charges the platform fee on bookings and reports it to the platform owner', async () => {
    const op = (method: 'get' | 'post', path: string) =>
      as(founder, method, path, selfServe.tenantId);
    const product = (
      await op('post', '/operator/products')
        .send({
          name: 'Tur de seară',
          slug: 'tur-de-seara',
          durationMinutes: 60,
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await op('post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-07', toDate: '2026-10-07', times: ['18:00'], capacity: 10 })
      .expect(201);
    const slots = (
      await h.http
        .get(
          `/public/tenants/${selfServe.slug}/products/tur-de-seara/slots?from=2026-10-07&to=2026-10-07`,
        )
        .expect(200)
    ).body as SlotDto[];
    const checkout = (
      await h.http
        .post(`/public/tenants/${selfServe.slug}/checkout`)
        .send({
          slotId: slots[0]!.id,
          items: [{ priceId: product.prices[0]!.id, quantity: 2 }],
          acceptTerms: true,
          customer: { name: 'Turist', email: 'turist@example.com', locale: 'ro' },
        })
        .expect(201)
    ).body as CheckoutResultDto;
    const key = new URL(checkout.ticketUrl).searchParams.get('k');
    await h.http.post(`/public/dev-payments/${checkout.booking.id}/succeed?k=${key}`).expect(204);
    await h.outbox.drain();

    const setup = await op('get', '/operator/onboarding').expect(200);
    expect(setup.body.steps).toEqual([
      { key: 'product', done: true },
      { key: 'departures', done: true },
      { key: 'commission_plan', done: false },
      { key: 'affiliate', done: true },
      { key: 'first_booking', done: true },
    ]);
    const billing = (await op('get', '/operator/billing').expect(200)).body as OperatorBillingDto;
    expect(billing.feesThisMonth).toEqual({ amountMinor: 800, currency: 'RON', bookings: 1 });

    const overview = (await as(admin, 'get', '/admin/overview').expect(200))
      .body as AdminOverviewDto;
    expect(overview.period).toBe('2026-10');
    expect(overview.operators).toEqual({
      total: 4,
      active: 0,
      trialing: 3,
      suspended: 0,
      pastDue: 0,
    });
    expect(overview.volume).toEqual([
      { currency: 'RON', bookings: 1, grossMinor: 20_000, platformFeesMinor: 800 },
    ]);
    const row = overview.tenants.find((t) => t.id === selfServe.tenantId)!;
    expect(row).toMatchObject({
      bookings: 1,
      grossMinor: 20_000,
      platformFeesMinor: 800,
      affiliates: 1,
    });
    await as(admin, 'get', '/admin/overview?period=2026-09')
      .expect(200)
      .expect((r) => expect(r.body.volume).toEqual([]));
  });

  it('records manual payments, plan changes and lapsed trials', async () => {
    const paid = await as(admin, 'patch', `/admin/tenants/${selfServe.tenantId}/billing`)
      .send({ paidUntil: '2026-12-05T00:00:00.000Z', priceMinorOverride: 1500 })
      .expect(200);
    expect(paid.body as SubscriptionDto).toMatchObject({
      status: 'active',
      monthlyPriceMinor: 1500,
      currentPeriodEnd: '2026-12-05T00:00:00.000Z',
      salesPauseAt: null,
    });
    await as(admin, 'patch', `/admin/tenants/${selfServe.tenantId}/billing`)
      .send({ trialEndsAt: '2026-12-01T00:00:00.000Z' })
      .expect(422);

    // The operator moves to Pro by themselves (manual billing: no card checkout).
    await as(founder, 'post', '/operator/billing/checkout', selfServe.tenantId)
      .send({ planId: plan('pro').id })
      .expect(201)
      .expect((r) => expect(r.body.url).toBe('http://web.test/o/billing?chosen=1'));
    expect(await fee(selfServe.tenantId)).toBe(200);

    h.clock.set('2026-11-10T08:00:00Z');
    const overview = (await as(admin, 'get', '/admin/overview').expect(200))
      .body as AdminOverviewDto;
    expect(overview.mrr).toEqual([{ currency: 'EUR', amountMinor: 1500 }]);
    // Both other trials have ended (19 October and 4 November) without a payment.
    expect(overview.operators).toMatchObject({ active: 1, trialing: 0, pastDue: 2 });

    // Not paid again by hand when the paid period ends: past due, with the usual grace days.
    h.clock.set('2026-12-06T08:00:00Z');
    const lapsed = (await as(admin, 'get', '/admin/overview').expect(200)).body as AdminOverviewDto;
    expect(lapsed.mrr).toEqual([]);
    expect(lapsed.operators).toMatchObject({ active: 0, pastDue: 3 });
    const billing = await as(founder, 'get', '/operator/billing', selfServe.tenantId).expect(200);
    expect(billing.body.subscription).toMatchObject({
      status: 'past_due',
      salesPauseAt: '2026-12-12T00:00:00.000Z',
    });
    h.clock.set('2026-10-05T08:00:00Z');
  });

  it('suspends an operator: console closed, booking pages offline, then reactivates', async () => {
    await as(admin, 'patch', `/admin/tenants/${selfServe.tenantId}/status`)
      .send({ status: 'suspended' })
      .expect(400);
    const suspended = await as(admin, 'patch', `/admin/tenants/${selfServe.tenantId}/status`)
      .send({ status: 'suspended', reason: 'Abonament neplătit' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      status: 'suspended',
      suspendedReason: 'Abonament neplătit',
    });

    await as(founder, 'get', '/operator/onboarding', selfServe.tenantId)
      .expect(403)
      .expect((r) => expect(r.body.message).toBe('this operator account is suspended'));
    await h.http.get(`/public/tenants/${selfServe.slug}`).expect(404);
    const me = (await as(founder, 'get', '/me').expect(200)).body as MeDto;
    expect(me.memberships.find((m) => m.tenantId === selfServe.tenantId)?.tenantStatus).toBe(
      'suspended',
    );

    await as(admin, 'patch', `/admin/tenants/${selfServe.tenantId}/status`)
      .send({ status: 'active' })
      .expect(200);
    await as(founder, 'get', '/operator/onboarding', selfServe.tenantId).expect(200);
    await h.http.get(`/public/tenants/${selfServe.slug}`).expect(200);

    const detail = (await as(admin, 'get', `/admin/tenants/${selfServe.tenantId}`).expect(200))
      .body as AdminTenantDetailDto;
    expect(detail.audit.map((a) => a.action).slice(0, 2)).toEqual([
      'tenant.reactivated',
      'tenant.suspended',
    ]);
    expect(detail.months.map((m) => m.period)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(detail.months.at(-1)).toMatchObject({ bookings: 1, platformFeesMinor: 800 });
  });

  it('can switch self-signup off so operators join only by invitation', async () => {
    await h.close();
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', { SELF_SIGNUP: 'false' });
    const someone = await signIn(h, 'someone@else.test');
    await h.http
      .get('/signup/options')
      .expect(200)
      .expect((r) => expect(r.body.selfSignup).toBe(false));
    await as(someone, 'post', '/signup/tenants').send({ name: 'Nu se poate' }).expect(403);
  });
});
