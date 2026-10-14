import type {
  AffiliateDto,
  AffiliateHomeDto,
  CheckoutResultDto,
  ClosePeriodResultDto,
  OperatorBillingDto,
  OperatorSettingsDto,
  ProductDto,
  PublicTenantDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { createDb, platformPlans, tenantSubscriptions, tenants } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetentionService } from '../src/retention/retention.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The messages that keep everyone coming back, over two months of a real operator: affiliates
 * hear about each sale, how close the next level is and when they were paid; customers get a
 * reminder the evening before and a review request the day after; the owner gets the monthly
 * report and fair warning before an unpaid subscription pauses new bookings.
 */
describe.skipIf(!databaseUrl)('retention messages (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let affiliateToken: string;
  let product: ProductDto;
  let affiliate: AffiliateDto;
  const sold: { email: string; result: CheckoutResultDto }[] = [];
  let fresh: CheckoutResultDto;
  const affiliatePhone = '+40722000009';

  const asOwner = (method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const asAffiliate = (method: 'get' | 'post' | 'put', path: string) =>
    h.http[method](path)
      .set('authorization', `Bearer ${affiliateToken}`)
      .set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const adult = () => product.prices.find((p) => p.code === 'adult')!;
  const runDue = () => h.app.get(RetentionService).runDue();
  const sentTo = async (to: string) => {
    await h.notifications.deliverDue();
    return h.messages.sent.filter((m) => m.to === to);
  };

  async function slotOn(date: string): Promise<SlotDto> {
    const listed = await h.http
      .get(`/public/tenants/delta-boats/products/sunset-cruise/slots?from=${date}&to=${date}`)
      .expect(200);
    return (listed.body as SlotDto[])[0]!;
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function affiliateSale(email: string): Promise<CheckoutResultDto> {
    const slot = await slotOn('2026-10-06');
    const response = await asAffiliate('post', '/affiliate/bookings')
      .send({
        slotId: slot.id,
        items: [{ priceId: adult().id, quantity: 1 }],
        customer: { name: 'Guest', email, locale: 'en' },
        payment: 'link',
      })
      .expect(201);
    const result = response.body as CheckoutResultDto;
    await pay(result);
    sold.push({ email, result });
    return result;
  }

  function checkout(date: string, email: string) {
    return slotOn(date).then((slot) =>
      h.http.post('/public/tenants/delta-boats/checkout').send({
        slotId: slot.id,
        items: [{ priceId: adult().id, quantity: 1 }],
        acceptTerms: true,
        customer: { name: 'Walk-in', email, locale: 'en' },
      }),
    );
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    // The operator joined before October, so October is theirs to report on.
    const handle = createDb(databaseUrl!, { max: 1 });
    await handle.db
      .update(tenants)
      .set({ createdAt: new Date('2026-09-01T00:00:00Z'), contactPhone: '+40700000000' })
      .where(eq(tenants.id, h.tenantId));
    await handle.close();
  });

  afterAll(async () => {
    await h?.close();
  });

  it('sets up a tiered plan, a trip with a meeting point and an affiliate who speaks German', async () => {
    await asOwner('post', '/operator/commission-plans')
      .send({
        kind: 'tiered',
        name: 'Standard',
        mode: 'marginal',
        tiers: [
          { fromSale: 1, rateBps: 1500 },
          { fromSale: 3, rateBps: 2000 },
          { fromSale: 5, rateBps: 2500 },
        ],
      })
      .expect(201);
    product = (
      await asOwner('post', '/operator/products')
        .send({
          name: 'Sunset cruise',
          slug: 'sunset-cruise',
          durationMinutes: 90,
          meetingPoint: 'Pier 3',
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await asOwner('post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-11-30', times: ['10:00'], capacity: 30 })
      .expect(201);

    affiliate = (
      await asOwner('post', '/operator/affiliates')
        .send({ displayName: 'Anna, Hotel Europa', destination: affiliatePhone })
        .expect(201)
    ).body as AffiliateDto;
    const token = affiliate.inviteUrl!.split('/join/')[1]!;
    // She signs in from a phone set to German: her messages follow.
    await h.http.post('/auth/otp/request').send({ destination: affiliatePhone }).expect(204);
    const code = /(\d{6})/.exec(h.messages.last(affiliatePhone)!.text)![1];
    affiliateToken = (
      await h.http
        .post('/auth/otp/verify')
        .set('accept-language', 'de-DE,de;q=0.9,en;q=0.5')
        .send({ destination: affiliatePhone, code })
        .expect(200)
    ).body.token as string;
    await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${affiliateToken}`)
      .send({ token, name: 'Anna' })
      .expect(201);
  });

  it('tells the affiliate about each sale and how far the next level is', async () => {
    h.clock.set('2026-10-05T08:01:00Z');
    await affiliateSale('c1@example.com');
    const first = await h.lastMessage(affiliatePhone);
    expect(first?.channel).toBe('sms');
    expect(first?.text).toContain('Delta Boats: neuer Verkauf! Sunset cruise');
    expect(first?.text).toMatch(/Noch 2 bis 20\s?%/);

    h.clock.set('2026-10-05T08:02:00Z');
    await affiliateSale('c2@example.com');
    expect((await h.lastMessage(affiliatePhone))?.text).toMatch(/Noch 1 bis 20\s?%/);

    h.clock.set('2026-10-05T08:03:00Z');
    await affiliateSale('c3@example.com');
    expect((await h.lastMessage(affiliatePhone))?.text).toMatch(/Sie haben 20\s?% erreicht!/);
  });

  it('lets the affiliate turn sale messages off and on', async () => {
    const off = await asAffiliate('put', '/affiliate/notifications')
      .send({ sales: false })
      .expect(200);
    expect(off.body).toEqual({ sales: false });
    const home = (await asAffiliate('get', '/affiliate/home').expect(200)).body as AffiliateHomeDto;
    expect(home.affiliate.notifySales).toBe(false);

    const before = (await sentTo(affiliatePhone)).length;
    h.clock.set('2026-10-05T08:04:00Z');
    await affiliateSale('c4@example.com');
    expect(await sentTo(affiliatePhone)).toHaveLength(before);

    await asAffiliate('put', '/affiliate/notifications').send({ sales: true }).expect(200);
    await h.http.put('/affiliate/notifications').send({ sales: true }).expect(401);
  });

  it('reminds customers the evening before, with the meeting point and the ticket', async () => {
    // Booked in the afternoon: the ticket only just arrived, no reminder needed.
    h.clock.set('2026-10-05T13:00:00Z');
    const response = await checkout('2026-10-06', 'fresh@example.com');
    expect(response.status).toBe(201);
    fresh = response.body as CheckoutResultDto;
    await pay(fresh);

    h.clock.set('2026-10-05T14:59:00Z');
    expect(await runDue()).toBe(0);

    // 18:00 in Bucharest.
    h.clock.set('2026-10-05T15:00:00Z');
    expect(await runDue()).toBe(4);
    for (const { email, result } of sold) {
      const reminder = await h.lastMessage(email);
      expect(reminder).toMatchObject({
        channel: 'email',
        subject: 'See you soon: Sunset cruise, 6 Oct 10:00',
      });
      expect(reminder?.text).toContain('Meeting point: Pier 3.');
      expect(reminder?.text).toContain('Questions? Call +40700000000.');
      expect(reminder?.text).toContain(`/t/${result.booking.id}?k=${keyOf(result)}`);
    }
    expect((await h.lastMessage('fresh@example.com'))?.subject).not.toMatch(/^See you soon/);

    // Running again (or on a second worker) sends nothing twice.
    expect(await runDue()).toBe(0);
  });

  it('asks only the customers who boarded for a review, the morning after', async () => {
    await asOwner('patch', '/operator/settings')
      .send({ reviewUrl: 'http://maps.test' })
      .expect(400);
    const settings = (
      await asOwner('patch', '/operator/settings')
        .send({ reviewUrl: 'https://g.page/r/delta-boats/review' })
        .expect(200)
    ).body as OperatorSettingsDto;
    expect(settings).toMatchObject({
      reviewUrl: 'https://g.page/r/delta-boats/review',
      remindCustomers: true,
      askForReviews: true,
      notifyAffiliates: true,
      monthlyReport: true,
    });

    h.clock.set('2026-10-06T06:50:00Z');
    const boarded = sold[0]!.result;
    const ticket = (
      await h.http.get(`/public/tickets/${boarded.booking.id}?k=${keyOf(boarded)}`).expect(200)
    ).body as TicketDto;
    await asOwner('post', '/operator/tickets/check-in')
      .send({ token: ticket.qrToken })
      .expect(200)
      .expect((r) => expect(r.body.result).toBe('checked_in'));
    await h.outbox.drain();

    h.clock.set('2026-10-07T06:59:00Z');
    expect(await runDue()).toBe(0);
    h.clock.set('2026-10-07T07:00:00Z');
    expect(await runDue()).toBe(1);
    const review = await h.lastMessage('c1@example.com');
    expect(review).toMatchObject({ channel: 'email', subject: 'How was Sunset cruise?' });
    expect(review?.text).toContain('https://g.page/r/delta-boats/review');
    // The others never showed up at the pier.
    for (const email of ['c2@example.com', 'c3@example.com', 'fresh@example.com']) {
      expect((await h.lastMessage(email))?.subject).not.toBe('How was Sunset cruise?');
    }
  });

  it('nudges the affiliate in the last days of the month when the next level is close', async () => {
    // 27 October, 09:59 in Bucharest (winter time from the 25th).
    h.clock.set('2026-10-27T07:59:00Z');
    expect(await runDue()).toBe(0);
    h.clock.set('2026-10-27T08:00:00Z');
    expect(await runDue()).toBe(1);
    const nudge = await h.lastMessage(affiliatePhone);
    expect(nudge?.text).toContain('Delta Boats: nur noch 1 in diesem Monat');
    expect(nudge?.text).toMatch(/steigt auf 25\s?%/);
    expect(nudge?.text).toContain('http://web.test/a/qr');
    h.clock.set('2026-10-28T08:00:00Z');
    expect(await runDue()).toBe(0);
  });

  it('sends the owner the report for the month that just ended', async () => {
    h.clock.set('2026-11-01T05:59:00Z');
    expect(await runDue()).toBe(0);
    h.clock.set('2026-11-01T06:00:00Z');
    expect(await runDue()).toBe(1);
    const report = await h.lastMessage(h.ownerEmail);
    expect(report).toMatchObject({
      channel: 'email',
      subject: 'Delta Boats: raportul pentru octombrie 2026',
    });
    expect(report?.text).toContain('Anna, Hotel Europa');
    expect(report?.text).toContain('http://web.test/o/payouts');
    expect(report?.html).toContain('Prin afiliați');
    h.clock.set('2026-11-02T06:00:00Z');
    expect(await runDue()).toBe(0);
  });

  it('tells the affiliate when the operator pays the commission', async () => {
    h.clock.set('2026-11-02T09:00:00Z');
    const closed = (
      await asOwner('post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-10' })
        .expect(200)
    ).body as ClosePeriodResultDto;
    const payout = closed.payouts[0]!;
    expect(payout.amountMinor).toBeGreaterThan(0);
    await asOwner('post', `/operator/payouts/${payout.id}/mark-paid`).expect(200);
    await h.outbox.drain();
    const paid = await h.lastMessage(affiliatePhone);
    expect(paid?.text).toContain('Delta Boats hat Ihre Provision');
    expect(paid?.text).toContain('Oktober 2026');
  });

  it('warns before the trial ends, then pauses new bookings after the grace days', async () => {
    const handle = createDb(databaseUrl!, { max: 1 });
    const [plan] = await handle.db.select().from(platformPlans).limit(1);
    await handle.db.insert(tenantSubscriptions).values({
      tenantId: h.tenantId,
      planId: plan!.id,
      status: 'trialing',
      trialEndsAt: new Date('2026-11-05T08:00:00Z'),
    });

    h.clock.set('2026-11-02T09:00:00Z');
    expect(await runDue()).toBe(1);
    expect((await h.lastMessage(h.ownerEmail))?.subject).toMatch(
      /^Perioada de probă gratuită se termină pe /,
    );
    expect(await runDue()).toBe(0);

    // The trial ended: one more week of sales, and the owner knows the date.
    h.clock.set('2026-11-05T09:00:00Z');
    expect(await runDue()).toBe(1);
    const unpaid = await h.lastMessage(h.ownerEmail);
    expect(unpaid?.subject).toBe('Abonamentul pentru Delta Boats nu este plătit');
    expect(unpaid?.text).toContain('Perioada de probă gratuită pentru Delta Boats s-a încheiat.');
    expect(unpaid?.text).toContain('http://web.test/o/billing');
    const billing = (await asOwner('get', '/operator/billing').expect(200))
      .body as OperatorBillingDto;
    expect(billing.subscription).toMatchObject({
      status: 'past_due',
      salesPauseAt: '2026-11-12T08:00:00.000Z',
    });
    expect((await checkout('2026-11-20', 'early@example.com')).status).toBe(201);

    h.clock.set('2026-11-12T09:00:00Z');
    const paused = await checkout('2026-11-20', 'late@example.com');
    expect(paused.status).toBe(409);
    expect(paused.body.code).toBe('errors.booking.salesPaused');
    const slot = await slotOn('2026-11-20');
    await asAffiliate('post', '/affiliate/bookings')
      .send({
        slotId: slot.id,
        items: [{ priceId: adult().id, quantity: 1 }],
        customer: { name: 'Guest', email: 'late@example.com' },
      })
      .expect(409);
    const page = (await h.http.get('/public/tenants/delta-boats').expect(200))
      .body as PublicTenantDto;
    expect(page.bookingPaused).toBe(true);
    expect(await runDue()).toBe(1);
    expect((await h.lastMessage(h.ownerEmail))?.subject).toBe(
      'Rezervările noi pentru Delta Boats sunt oprite',
    );
    expect(await runDue()).toBe(0);

    // Paid: bookings start again at once.
    await handle.db
      .update(tenantSubscriptions)
      .set({ status: 'active', currentPeriodEnd: new Date('2026-12-12T09:00:00Z') })
      .where(eq(tenantSubscriptions.tenantId, h.tenantId));
    await handle.close();
    expect((await checkout('2026-11-20', 'late@example.com')).status).toBe(201);
    expect(
      ((await h.http.get('/public/tenants/delta-boats').expect(200)).body as PublicTenantDto)
        .bookingPaused,
    ).toBe(false);
  });
});
