import type {
  AffiliateDto,
  AffiliateHomeDto,
  AffiliateWithStatsDto,
  BookingDto,
  CheckInResultDto,
  CheckoutResultDto,
  ClosePeriodResultDto,
  CommissionReportDto,
  EarningsDto,
  LinkDto,
  ProductDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingService } from '../src/booking/booking.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The whole affiliate journey against a real database: an operator sets up commissions and a
 * trip, invites a receptionist, customers book through the QR code or at the reception desk,
 * tickets are scanned at boarding, a booking is refunded and the month is closed and paid.
 */
describe.skipIf(!databaseUrl)('affiliate flow end to end (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let affiliateToken: string;
  let product: ProductDto;
  let slots: SlotDto[];
  let affiliate: AffiliateDto;
  let linkCode: string;
  const confirmed: CheckoutResultDto[] = [];
  const affiliatePhone = '+40722000001';

  const asOwner = (method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const asAffiliate = (method: 'get' | 'post', path: string) =>
    h.http[method](path)
      .set('authorization', `Bearer ${affiliateToken}`)
      .set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const adult = () => product.prices.find((p) => p.code === 'adult')!;

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function publicBooking(
    slot: SlotDto,
    adults: number,
    ref?: string,
  ): Promise<CheckoutResultDto> {
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: adult().id, quantity: adults }],
        customer: { name: 'Tourist', email: 'tourist@example.com', locale: 'en' },
        ref,
        refSource: 'qr',
        visitorId: 'visitor-123456',
      })
      .expect(201);
    return response.body as CheckoutResultDto;
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('lets the operator define a progressive plan, a trip and its departures', async () => {
    await asOwner('post', '/operator/commission-plans')
      .send({
        kind: 'tiered',
        name: 'Standard',
        mode: 'marginal',
        tiers: [
          { fromSale: 1, rateBps: 1500 },
          { fromSale: 4, rateBps: 2000 },
          { fromSale: 11, rateBps: 2500 },
        ],
      })
      .expect(201)
      .expect((r) => expect(r.body.isDefault).toBe(true));

    const created = await asOwner('post', '/operator/products')
      .send({
        name: 'Sunset cruise',
        slug: 'sunset-cruise',
        durationMinutes: 90,
        meetingPoint: 'Pier 3',
        prices: [
          { code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 },
          { code: 'child', label: 'Child', amountMinor: 5_000, taxRateBps: 900 },
        ],
      })
      .expect(201);
    product = created.body as ProductDto;
    expect(product.fromMinor).toBe(5_000);

    await asOwner('post', `/operator/products/${product.id}/slots`)
      .send({
        fromDate: '2026-10-06',
        toDate: '2026-10-10',
        times: ['10:00', '18:00'],
        capacity: 10,
      })
      .expect(201)
      .expect((r) => expect(r.body.created).toBe(10));

    const listed = await h.http
      .get('/public/tenants/delta-boats/products/sunset-cruise/slots?from=2026-10-06&to=2026-10-06')
      .expect(200);
    slots = listed.body as SlotDto[];
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2026-10-06T07:00:00.000Z',
      '2026-10-06T15:00:00.000Z',
    ]);
  });

  it('invites a receptionist who joins with a code sent by SMS', async () => {
    const invited = await asOwner('post', '/operator/affiliates')
      .send({ displayName: 'Ana, Hotel Central', destination: affiliatePhone })
      .expect(201);
    affiliate = invited.body as AffiliateDto;
    expect(affiliate.status).toBe('invited');
    const token = affiliate.inviteUrl!.split('/join/')[1]!;
    expect((await h.lastMessage(affiliatePhone))?.text).toContain(affiliate.inviteUrl);

    await h.http
      .get(`/invites/${token}`)
      .expect(200)
      .expect((r) => expect(r.body.tenantName).toBe('Delta Boats'));
    affiliateToken = await signIn(h, affiliatePhone);
    const me = await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${affiliateToken}`)
      .send({ token, name: 'Ana' })
      .expect(201);
    expect(me.body.memberships).toEqual([
      expect.objectContaining({ role: 'affiliate', affiliateId: affiliate.id }),
    ]);
    await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${affiliateToken}`)
      .send({ token })
      .expect(404);
  });

  it('shows the affiliate an empty month with the next tier ahead', async () => {
    const home = (await asAffiliate('get', '/affiliate/home').expect(200)).body as AffiliateHomeDto;
    expect(home.progress).toMatchObject({
      paidSales: 0,
      currentRateBps: 1500,
      nextRateBps: 2000,
      salesToNextTier: 4,
    });
    expect(home.primaryLink.url).toMatch(/^http:\/\/web\.test\/r\/[A-Z0-9]{7}$/);
    expect(home.primaryLink.qrUrl).toBe(`${home.primaryLink.url}?s=qr`);
    expect(home.tenant.branding).toEqual({});
    expect(home.history.map((m) => m.periodKey)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(home.history.every((m) => m.paidSales === 0 && m.commissionMinor === 0)).toBe(true);
    linkCode = home.primaryLink.code;
  });

  it('keeps everyone in their lane', async () => {
    await h.http.get('/affiliate/home').expect(401);
    await asAffiliate('get', '/operator/affiliates').expect(403);
    await h.http
      .get('/affiliate/home')
      .set('authorization', `Bearer ${affiliateToken}`)
      .set('x-tenant-id', '00000000-0000-0000-0000-000000000000')
      .expect(403);
  });

  it('attributes a QR scan and its paid booking to the affiliate at 15%', async () => {
    const click = await h.http
      .post(`/public/links/${linkCode}/click`)
      .send({ visitorId: 'visitor-123456' })
      .expect(200);
    expect(click.body).toEqual({
      tenantSlug: 'delta-boats',
      productSlug: null,
      attributionWindowDays: 30,
    });

    const checkout = await publicBooking(slots[0]!, 2, linkCode);
    expect(checkout.booking).toMatchObject({
      status: 'pending_payment',
      channel: 'qr',
      totalMinor: 20_000,
      seats: 2,
    });
    expect(checkout.paymentUrl).toContain(`/dev/pay/${checkout.booking.id}`);

    const ticketBefore = (
      await h.http.get(`/public/tickets/${checkout.booking.id}?k=${keyOf(checkout)}`).expect(200)
    ).body as TicketDto;
    expect(ticketBefore).toMatchObject({ status: 'pending_payment', qrToken: null });

    await pay(checkout);
    confirmed.push(checkout);
    const earnings = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(earnings.entries).toEqual([
      expect.objectContaining({
        kind: 'sale',
        status: 'pending',
        rateBps: 1500,
        baseMinor: 20_000,
        amountMinor: 3_000,
      }),
    ]);
    const ticketEmail = await h.lastMessage('tourist@example.com');
    expect(ticketEmail).toMatchObject({
      channel: 'email',
      subject: 'Your ticket: Sunset cruise, 6 Oct 10:00',
    });
    expect(ticketEmail?.text).toContain(`/t/${checkout.booking.id}?k=${keyOf(checkout)}&lang=en`);
    expect(ticketEmail?.html).toContain('src="cid:ticket-qr"');
    expect(ticketEmail?.attachments).toEqual([
      expect.objectContaining({ contentId: 'ticket-qr', contentType: 'image/png' }),
      expect.objectContaining({
        filename: `ticket-${checkout.booking.reference}.pdf`,
        contentType: 'application/pdf',
      }),
    ]);
  });

  it('ignores unknown referral codes', async () => {
    const checkout = await publicBooking(slots[1]!, 1, 'NOPE123');
    expect(checkout.booking).toMatchObject({ channel: 'direct', affiliateName: null });
    await pay(checkout);
  });

  it('lets the receptionist book instantly; the 4th sale of the month earns 20%', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await asAffiliate('post', '/affiliate/bookings')
        .send({
          slotId: slots[1]!.id,
          items: [{ priceId: adult().id, quantity: 1 }],
          customer: { name: `Guest ${i}`, phone: '+40733000000', locale: 'ro', hotelRoom: '214' },
          payment: 'link',
        })
        .expect(201);
      const result = response.body as CheckoutResultDto;
      expect(result.booking.channel).toBe('affiliate_assisted');
      await h.notifications.deliverDue();
      expect(
        h.messages.sent.filter((m) => m.to === '+40733000000').map((m) => m.text),
      ).toContainEqual(expect.stringContaining(result.paymentUrl!));
      h.clock.set(`2026-10-05T08:0${i + 1}:00Z`);
      await pay(result);
      confirmed.push(result);
    }
    const earnings = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(earnings.entries.map((e) => e.rateBps).sort()).toEqual([1500, 1500, 1500, 2000]);
    expect(earnings.totalMinor).toBe(3_000 + 1_500 + 1_500 + 2_000);

    const home = (await asAffiliate('get', '/affiliate/home').expect(200)).body as AffiliateHomeDto;
    expect(home.progress).toMatchObject({
      paidSales: 4,
      currentRateBps: 2000,
      nextRateBps: 2500,
      salesToNextTier: 7,
    });
    expect(home.earnings).toMatchObject({ pendingMinor: 8_000, monthTotalMinor: 8_000 });
    expect(home.history.at(-1)).toEqual({
      periodKey: '2026-10',
      paidSales: 4,
      salesMinor: confirmed.reduce((sum, c) => sum + c.booking.totalMinor, 0),
      commissionMinor: 8_000,
    });

    // The operator's list and the affiliate's links show the same month.
    const listed = (await asOwner('get', '/operator/affiliates').expect(200))
      .body as AffiliateWithStatsDto[];
    expect(listed.find((a) => a.id === affiliate.id)?.month).toMatchObject({
      paidSales: 4,
      earnedMinor: 8_000,
    });
    const links = (await asAffiliate('get', '/affiliate/links').expect(200)).body as LinkDto[];
    expect(links.find((l) => l.code === linkCode)).toMatchObject({ clicks: 1, sales: 1 });
  });

  it('never sells more seats than the boat has', async () => {
    const [after] = (
      await h.http
        .get(
          '/public/tenants/delta-boats/products/sunset-cruise/slots?from=2026-10-06&to=2026-10-06',
        )
        .expect(200)
    ).body as SlotDto[];
    expect(after!.available).toBe(8);
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slots[0]!.id,
        items: [{ priceId: adult().id, quantity: 9 }],
        customer: { name: 'Big group', email: 'group@example.com' },
      })
      .expect(409);
    expect(response.body.message).toContain('only 8 seats left');
  });

  it('scans the ticket at boarding exactly once and approves the commission', async () => {
    const first = confirmed[0]!;
    const ticket = (
      await h.http.get(`/public/tickets/${first.booking.id}?k=${keyOf(first)}`).expect(200)
    ).body as TicketDto;
    expect(ticket.status).toBe('valid');
    const scan = () =>
      asOwner('post', '/operator/tickets/check-in').send({ token: ticket.qrToken });
    expect((await scan().expect(200)).body).toMatchObject({
      result: 'checked_in',
      collectMinor: 0,
    });
    expect(((await scan().expect(200)).body as CheckInResultDto).result).toBe('already_checked_in');
    const forged = await asOwner('post', '/operator/tickets/check-in').send({
      token: `${ticket.qrToken!.slice(0, -4)}AAAA`,
    });
    expect((forged.body as CheckInResultDto).result).toBe('not_valid');

    await h.outbox.drain();
    const earnings = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(
      earnings.entries.find((e) => e.bookingReference === first.booking.reference)?.status,
    ).toBe('approved');
  });

  it('refunds a cancelled booking, frees its seats and reverses the commission', async () => {
    const second = confirmed[1]!;
    const cancelled = await asOwner('post', `/operator/bookings/${second.booking.id}/cancel`)
      .send({ reason: 'customer is ill' })
      .expect(200);
    expect((cancelled.body as BookingDto).status).toBe('refunded');
    expect(h.payments.refunds).toEqual([expect.objectContaining({ amountMinor: 10_000 })]);
    await h.outbox.drain();

    const earnings = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    const forBooking = earnings.entries.filter(
      (e) => e.bookingReference === second.booking.reference,
    );
    expect(forBooking.map((e) => [e.kind, e.amountMinor, e.status])).toEqual(
      expect.arrayContaining([
        ['sale', 1_500, 'approved'],
        ['reversal', -1_500, 'approved'],
      ]),
    );
    const ticket = (
      await h.http.get(`/public/tickets/${second.booking.id}?k=${keyOf(second)}`).expect(200)
    ).body as TicketDto;
    expect(ticket).toMatchObject({ status: 'void', qrToken: null });
    await h.notifications.deliverDue();
    const notice = h.messages.sent.find(
      (m) => m.to === '+40733000000' && m.text.includes(`rezervarea ${second.booking.reference}`),
    );
    expect(notice?.text).toContain('a fost anulata. Banii iti sunt returnati');
  });

  it('counts a pay-at-boarding booking only once the customer boards', async () => {
    const response = await asAffiliate('post', '/affiliate/bookings')
      .send({
        slotId: slots[1]!.id,
        items: [{ priceId: adult().id, quantity: 2 }],
        customer: { name: 'Cash guest', phone: '+40744000000' },
        payment: 'on_site',
      })
      .expect(201);
    const result = response.body as CheckoutResultDto;
    expect(result.paymentUrl).toBeNull();
    expect(result.booking).toMatchObject({
      status: 'confirmed',
      paymentMode: 'on_site',
      paidAt: null,
    });
    await h.outbox.drain();
    const before = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(before.entries.some((e) => e.bookingReference === result.booking.reference)).toBe(false);

    const ticket = (
      await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200)
    ).body as TicketDto;
    expect(ticket).toMatchObject({ amountDueOnSiteMinor: 20_000, timezone: 'Europe/Bucharest' });
    const ticketSms = await h.lastMessage('+40744000000');
    expect(ticketSms).toMatchObject({ channel: 'sms' });
    expect(ticketSms?.text).toContain(`ticket ${result.booking.reference} for Sunset cruise`);
    expect(ticketSms?.text).toContain('to pay at boarding RON');
    h.clock.set('2026-10-06T14:50:00Z');
    const boarding = await asOwner('post', '/operator/tickets/check-in')
      .send({ token: ticket.qrToken })
      .expect(200);
    expect(boarding.body).toMatchObject({ result: 'checked_in', collectMinor: 20_000 });
    await h.outbox.drain();
    const after = (await asAffiliate('get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    // Sales so far: 4 paid, 1 refunded -> this is sale #4 of the month, at 20%.
    expect(
      after.entries.find((e) => e.bookingReference === result.booking.reference),
    ).toMatchObject({
      kind: 'sale',
      status: 'approved',
      rateBps: 2000,
      amountMinor: 4_000,
    });
  });

  it('releases seats of unpaid checkouts and still honours a late payment', async () => {
    h.clock.set('2026-10-07T08:00:00Z');
    const [slot] = (
      await h.http
        .get(
          '/public/tenants/delta-boats/products/sunset-cruise/slots?from=2026-10-08&to=2026-10-08',
        )
        .expect(200)
    ).body as SlotDto[];
    const pending = await publicBooking(slot!, 3, linkCode);
    h.clock.set('2026-10-07T08:31:00Z');
    expect(await h.app.get(BookingService).expireUnpaid()).toBe(1);
    const [freed] = (
      await h.http
        .get(
          '/public/tenants/delta-boats/products/sunset-cruise/slots?from=2026-10-08&to=2026-10-08',
        )
        .expect(200)
    ).body as SlotDto[];
    expect(freed!.available).toBe(10);

    await pay(pending);
    const [taken] = (
      await h.http
        .get(
          '/public/tenants/delta-boats/products/sunset-cruise/slots?from=2026-10-08&to=2026-10-08',
        )
        .expect(200)
    ).body as SlotDto[];
    expect(taken!.available).toBe(7);
  });

  it('closes the month: re-tiers after the refund, pays the affiliate and locks the ledger', async () => {
    await asOwner('post', '/operator/payouts/close-period')
      .send({ periodKey: '2026-10' })
      .expect(409);

    h.clock.set('2026-11-02T09:00:00Z');
    const closed = (
      await asOwner('post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-10' })
        .expect(200)
    ).body as ClosePeriodResultDto;
    // October, in payment order: #1 3000 (15%), refunded (1500 - 1500), #2 1500, #3 1500 (it was
    // #4 at 20% before the refund, so -500), #4 pay-at-boarding 4000 (20%), #5 late payment 6000 (20%).
    expect(closed.adjustmentsCreated).toBe(1);
    expect(closed.payouts).toHaveLength(1);
    const payout = closed.payouts[0]!;
    expect(payout).toMatchObject({
      affiliateName: 'Ana, Hotel Central',
      status: 'approved',
      method: 'manual',
    });
    expect(payout.amountMinor).toBe(3_000 + 1_500 + 2_000 - 500 + 4_000 + 6_000);

    const again = (
      await asOwner('post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-10' })
        .expect(200)
    ).body as ClosePeriodResultDto;
    expect(again).toMatchObject({
      adjustmentsCreated: 0,
      payouts: [expect.objectContaining({ id: payout.id })],
    });

    const paid = await asOwner('post', `/operator/payouts/${payout.id}/mark-paid`).expect(200);
    expect(paid.body.status).toBe('paid');

    const report = (await asOwner('get', '/operator/commissions/report?period=2026-10').expect(200))
      .body as CommissionReportDto;
    expect(report.rows).toEqual([
      expect.objectContaining({
        affiliateName: 'Ana, Hotel Central',
        paidSales: 5,
        paidMinor: payout.amountMinor,
        pendingMinor: 0,
      }),
    ]);
    const dashboard = await asOwner('get', '/operator/dashboard').expect(200);
    expect(dashboard.body.affiliates).toEqual({ active: 1, invited: 0 });
  });
});
