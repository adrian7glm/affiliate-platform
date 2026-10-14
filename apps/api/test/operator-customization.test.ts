import type {
  AffiliateDto,
  BookingDto,
  CheckInResultDto,
  CheckoutResultDto,
  ClosePeriodResultDto,
  DepartureDayDto,
  DeparturePassengersDto,
  EarningsDto,
  ProductDto,
  PublicTenantDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * What an operator makes their own: the trip in the customers' languages, a message on every
 * ticket, their own questions on the booking form, a commission rate per trip, and the list of
 * passengers of each departure for boarding.
 */
describe.skipIf(!databaseUrl)('operator customization (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let affiliateToken: string;
  let affiliate: AffiliateDto;
  let sunset: ProductDto;
  let delta: ProductDto;
  let sunsetSlot: SlotDto;
  let deltaSlot: SlotDto;
  const affiliatePhone = '+40722000555';
  const note = 'Veniți cu 15 minute înainte. Luați o pălărie.';

  const as = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function affiliateBooking(
    slot: SlotDto,
    product: ProductDto,
    payment: 'link' | 'on_site' = 'link',
  ): Promise<CheckoutResultDto> {
    const response = await as(affiliateToken, 'post', '/affiliate/bookings')
      .send({
        slotId: slot.id,
        items: [{ priceId: product.prices[0]!.id, quantity: 1 }],
        customer: { name: 'Guest', phone: '+40733000000', locale: 'ro', hotelRoom: '12' },
        answers: product.questions
          .filter((q) => q.required)
          .map((q) => ({ questionId: q.id, value: q.options[0]?.value ?? 'Hotel Central' })),
        payment,
      })
      .expect(201);
    return response.body as CheckoutResultDto;
  }

  async function slotsOf(slug: string): Promise<SlotDto[]> {
    return (
      await h.http
        .get(`/public/tenants/delta-boats/products/${slug}/slots?from=2026-10-06&to=2026-10-06`)
        .expect(200)
    ).body as SlotDto[];
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    // Retroactive: once an affiliate makes 3 sales in a month, all of them earn 20%.
    await as(owner, 'post', '/operator/commission-plans')
      .send({
        kind: 'tiered',
        name: 'Standard',
        mode: 'retroactive',
        tiers: [
          { fromSale: 1, rateBps: 1000 },
          { fromSale: 3, rateBps: 2000 },
        ],
      })
      .expect(201);

    sunset = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Plimbare la apus',
          slug: 'sunset',
          description: 'O oră și jumătate pe Dunăre.',
          durationMinutes: 90,
          meetingPoint: 'Ponton 3, Tulcea',
          prices: [
            { code: 'adult', label: 'Adult', amountMinor: 10_000 },
            { code: 'copil', label: 'Copil', amountMinor: 5_000 },
          ],
          customerNote: note,
          questions: [
            {
              id: 'hotel',
              label: 'Hotelul de unde vă luăm',
              kind: 'text',
              required: true,
            },
            {
              id: 'meal',
              label: 'Meniu',
              kind: 'choice',
              required: false,
              options: ['Pește', 'Vegetarian'],
            },
          ],
        })
        .expect(201)
    ).body as ProductDto;
    delta = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Excursie de o zi în Deltă',
          slug: 'delta-day',
          durationMinutes: 480,
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 40_000 }],
          commissionRateBps: 2500,
        })
        .expect(201)
    ).body as ProductDto;
    for (const product of [sunset, delta]) {
      await as(owner, 'post', `/operator/products/${product.id}/slots`)
        .send({ fromDate: '2026-10-06', toDate: '2026-10-06', times: ['10:00'], capacity: 20 })
        .expect(201);
    }
    sunsetSlot = (await slotsOf('sunset'))[0]!;
    deltaSlot = (await slotsOf('delta-day'))[0]!;
  });

  afterAll(async () => {
    await h?.close();
  });

  it('keeps the note, the questions and the trip commission the operator set', () => {
    expect(sunset.customerNote).toBe(note);
    expect(sunset.questions).toEqual([
      { id: 'hotel', label: 'Hotelul de unde vă luăm', kind: 'text', required: true, options: [] },
      {
        id: 'meal',
        label: 'Meniu',
        kind: 'choice',
        required: false,
        options: [
          { value: 'Pește', label: 'Pește' },
          { value: 'Vegetarian', label: 'Vegetarian' },
        ],
      },
    ]);
    expect(sunset.commissionRateBps).toBeNull();
    expect(sunset.translations).toEqual({});
    expect(delta.commissionRateBps).toBe(2500);
  });

  it('refuses questions and rates that make no sense', async () => {
    const patch = (body: object) =>
      as(owner, 'patch', `/operator/products/${sunset.id}`).send(body);
    await patch({
      questions: [{ id: 'menu', label: 'Meniu', kind: 'choice', options: ['Pește'] }],
    }).expect(400);
    await patch({
      questions: [{ id: 'menu', label: 'Meniu', kind: 'choice', options: ['Pește', 'pește'] }],
    }).expect(400);
    await patch({
      questions: [
        { id: 'same', label: 'A', kind: 'text' },
        { id: 'same', label: 'B', kind: 'text' },
      ],
    }).expect(400);
    await patch({ commissionRateBps: 12_000 }).expect(400);
    await patch({ translations: { 'not a language': { name: 'x' } } }).expect(400);
  });

  it('translates the trip: customers see it in their language, operators see their own texts', async () => {
    const [adult, child] = sunset.prices;
    sunset = (
      await as(owner, 'patch', `/operator/products/${sunset.id}`)
        .send({
          translations: {
            de: {
              name: 'Sonnenuntergang auf der Donau',
              description: 'Anderthalb Stunden auf der Donau.',
              meetingPoint: 'Anleger 3, Tulcea',
              customerNote: 'Kommen Sie 15 Minuten früher. Nehmen Sie einen Hut mit.',
              prices: { [adult!.id]: 'Erwachsener', [child!.id]: '' },
              questions: {
                hotel: { label: 'Ihr Hotel (wir holen Sie ab)' },
                meal: { label: 'Menü', options: ['Fisch', 'Vegetarisch'] },
              },
            },
            en: { name: 'Danube sunset', meetingPoint: '', customerNote: 'Come 15 minutes early.' },
            fr: { name: '', description: '' },
          },
        })
        .expect(200)
    ).body as ProductDto;
    // Operators get their own texts, and empty translations are not kept.
    expect(sunset.name).toBe('Plimbare la apus');
    expect(Object.keys(sunset.translations!)).toEqual(['de', 'en']);
    expect(sunset.translations!.de!.prices).toEqual({ [adult!.id]: 'Erwachsener' });

    const german = (
      await h.http
        .get('/public/tenants/delta-boats/products/sunset')
        .set('accept-language', 'de-DE,de;q=0.9')
        .expect(200)
    ).body as ProductDto;
    expect(german).toMatchObject({
      name: 'Sonnenuntergang auf der Donau',
      description: 'Anderthalb Stunden auf der Donau.',
      meetingPoint: 'Anleger 3, Tulcea',
      customerNote: 'Kommen Sie 15 Minuten früher. Nehmen Sie einen Hut mit.',
      commissionRateBps: null,
    });
    expect(german.translations).toBeUndefined();
    // Not translated: the operator's own label.
    expect(german.prices.map((p) => p.label)).toEqual(['Erwachsener', 'Copil']);
    expect(german.questions[1]).toMatchObject({
      label: 'Menü',
      options: [
        { value: 'Pește', label: 'Fisch' },
        { value: 'Vegetarian', label: 'Vegetarisch' },
      ],
    });

    // English: only the name and note are translated; the rest stays in Romanian.
    const tenant = (
      await h.http.get('/public/tenants/delta-boats').set('accept-language', 'en').expect(200)
    ).body as PublicTenantDto;
    expect(tenant.products.find((p) => p.slug === 'sunset')).toMatchObject({
      name: 'Danube sunset',
      meetingPoint: 'Ponton 3, Tulcea',
      customerNote: 'Come 15 minutes early.',
    });
    // French has nothing: everything in Romanian.
    const french = (
      await h.http
        .get('/public/tenants/delta-boats/products/sunset')
        .set('accept-language', 'fr')
        .expect(200)
    ).body as ProductDto;
    expect(french.name).toBe('Plimbare la apus');
  });

  it('asks the trip questions at booking and keeps the answers with the booking', async () => {
    const checkout = (answers: { questionId: string; value: string }[], lang = 'de') =>
      h.http
        .post('/public/tenants/delta-boats/checkout')
        .set('accept-language', lang)
        .send({
          slotId: sunsetSlot.id,
          items: [{ priceId: sunset.prices[0]!.id, quantity: 2 }],
          acceptTerms: true,
          customer: { name: 'Hans Müller', email: 'hans@example.com', locale: 'de' },
          answers,
        });

    const missing = await checkout([{ questionId: 'meal', value: 'Pește' }]).expect(400);
    expect(missing.body.message).toContain('Ihr Hotel (wir holen Sie ab)');
    await checkout([
      { questionId: 'hotel', value: 'Hotel Delta' },
      { questionId: 'meal', value: 'Fisch' },
    ]).expect(400);

    const result = (
      await checkout([
        { questionId: 'hotel', value: '  Hotel Delta ' },
        { questionId: 'meal', value: 'Pește' },
        { questionId: 'removed-question', value: 'ignored' },
      ]).expect(201)
    ).body as CheckoutResultDto;
    expect(result.booking.answers).toEqual([
      { questionId: 'hotel', label: 'Hotelul de unde vă luăm', value: 'Hotel Delta' },
      { questionId: 'meal', label: 'Meniu', value: 'Pește' },
    ]);
    // The payment page shows the trip in the customer's language.
    expect(h.payments.checkouts.at(-1)!.lines).toEqual([
      expect.objectContaining({ name: 'Sonnenuntergang auf der Donau · Erwachsener', quantity: 2 }),
    ]);
    await pay(result);

    const bookings = (
      await as(owner, 'get', '/operator/bookings?from=2026-10-06&to=2026-10-06').expect(200)
    ).body as BookingDto[];
    expect(bookings.find((b) => b.id === result.booking.id)?.answers).toHaveLength(2);

    // The ticket, its email and its PDF: the trip in German, with the operator's message.
    const ticket = (
      await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200)
    ).body as TicketDto;
    expect(ticket).toMatchObject({
      productName: 'Sonnenuntergang auf der Donau',
      meetingPoint: 'Anleger 3, Tulcea',
      customerNote: 'Kommen Sie 15 Minuten früher. Nehmen Sie einen Hut mit.',
      items: [{ label: 'Erwachsener', quantity: 2 }],
    });
    const inRomanian = (
      await h.http
        .get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}&lang=ro`)
        .expect(200)
    ).body as TicketDto;
    expect(inRomanian).toMatchObject({ productName: 'Plimbare la apus', customerNote: note });
    const email = await h.lastMessage('hans@example.com');
    expect(email?.subject).toContain('Sonnenuntergang auf der Donau');
    expect(email?.text).toContain('Kommen Sie 15 Minuten früher');
    await h.http
      .get(`/public/tickets/${result.booking.id}/pdf?k=${keyOf(result)}`)
      .expect(200)
      .expect('content-type', 'application/pdf');
  });

  it('pays the trip rate to every affiliate, and the month close keeps it', async () => {
    const invited = (
      await as(owner, 'post', '/operator/affiliates')
        .send({ displayName: 'Ana, Hotel Central', destination: affiliatePhone })
        .expect(201)
    ).body as AffiliateDto;
    affiliateToken = await signIn(h, affiliatePhone);
    await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${affiliateToken}`)
      .send({ token: invited.inviteUrl!.split('/join/')[1]!, name: 'Ana' })
      .expect(201);
    affiliate = invited;

    // Affiliates see which trip pays its own rate.
    const offered = (await as(affiliateToken, 'get', '/affiliate/products').expect(200))
      .body as ProductDto[];
    expect(offered.find((p) => p.id === delta.id)?.commissionRateBps).toBe(2500);

    // Sale 1: plan (10%), sale 2: the day trip's own 25%, sale 3: plan, tier 2 reached.
    for (const product of [sunset, delta, sunset]) {
      h.clock.set(new Date(h.clock.now().getTime() + 60_000).toISOString());
      await pay(await affiliateBooking(product === sunset ? sunsetSlot : deltaSlot, product));
    }
    let earnings = (
      await as(affiliateToken, 'get', '/affiliate/earnings?period=2026-10').expect(200)
    ).body as EarningsDto;
    expect(earnings.entries.map((e) => e.rateBps).sort()).toEqual([1000, 2000, 2500]);

    // Month end: the retroactive tier lifts the plan sales to 20%; the trip keeps its 25%.
    h.clock.set('2026-11-01T10:00:00Z');
    const closed = (
      await as(owner, 'post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-10' })
        .expect(200)
    ).body as ClosePeriodResultDto;
    expect(closed.adjustmentsCreated).toBe(1);
    earnings = (await as(affiliateToken, 'get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(earnings.totalMinor).toBe(2000 + 10_000 + 2000);
  });

  it('pays an affiliate with a negotiated rate that rate on every trip', async () => {
    await as(owner, 'patch', `/operator/affiliates/${affiliate.id}`)
      .send({ commissionRateBpsOverride: 1800 })
      .expect(200);
    const offered = (await as(affiliateToken, 'get', '/affiliate/products').expect(200))
      .body as ProductDto[];
    expect(offered.find((p) => p.id === delta.id)?.commissionRateBps).toBeNull();

    h.clock.set('2026-11-02T08:00:00Z');
    await as(owner, 'post', `/operator/products/${delta.id}/slots`)
      .send({ fromDate: '2026-11-03', toDate: '2026-11-03', times: ['10:00'], capacity: 20 })
      .expect(201);
    const [november] = (
      await h.http
        .get('/public/tenants/delta-boats/products/delta-day/slots?from=2026-11-03&to=2026-11-03')
        .expect(200)
    ).body as SlotDto[];
    await pay(await affiliateBooking(november!, delta));
    const earnings = (
      await as(affiliateToken, 'get', '/affiliate/earnings?period=2026-11').expect(200)
    ).body as EarningsDto;
    expect(earnings.entries.map((e) => e.rateBps)).toEqual([1800]);
    h.clock.set('2026-10-05T09:00:00Z');
  });

  it("lists the day's departures and who is on each, and boards a passenger by hand", async () => {
    const onSite = await affiliateBooking(sunsetSlot, sunset, 'on_site');
    const unpaid = await affiliateBooking(sunsetSlot, sunset);

    const day = (await as(owner, 'get', '/operator/departures?date=2026-10-06').expect(200))
      .body as DepartureDayDto;
    expect(day.timezone).toBe('Europe/Bucharest');
    expect(
      day.departures.map((d) => [d.productName, d.seatsBooked, d.bookings, d.pendingPayment]),
    ).toEqual([
      ['Excursie de o zi în Deltă', 1, 1, 0],
      ['Plimbare la apus', 5, 4, 1],
    ]);

    const list = (
      await as(owner, 'get', `/operator/departures/${sunsetSlot.id}/passengers`).expect(200)
    ).body as DeparturePassengersDto;
    expect(list.passengers).toHaveLength(5);
    const hans = list.passengers.find((p) => p.customerName === 'Hans Müller')!;
    expect(hans).toMatchObject({
      status: 'confirmed',
      seats: 2,
      customerEmail: 'hans@example.com',
      items: [{ label: 'Adult', quantity: 2 }],
      boardedAt: null,
      affiliateName: null,
    });
    expect(hans.answers.map((a) => a.value)).toEqual(['Hotel Delta', 'Pește']);
    const atDesk = list.passengers.find((p) => p.bookingId === onSite.booking.id)!;
    expect(atDesk).toMatchObject({
      paymentMode: 'on_site',
      amountDueMinor: 10_000,
      affiliateName: 'Ana, Hotel Central',
      hotelRoom: '12',
    });
    expect(list.passengers.find((p) => p.bookingId === unpaid.booking.id)?.status).toBe(
      'pending_payment',
    );

    // Hans forgot his phone: the crew finds him on the list and boards him.
    const boarded = (
      await as(owner, 'post', `/operator/bookings/${hans.bookingId}/board`).expect(200)
    ).body as CheckInResultDto;
    expect(boarded.result).toBe('checked_in');
    const again = (
      await as(owner, 'post', `/operator/bookings/${hans.bookingId}/board`).expect(200)
    ).body as CheckInResultDto;
    expect(again.result).toBe('already_checked_in');
    // The pay-at-boarding passenger pays when boarded.
    const paid = (
      await as(owner, 'post', `/operator/bookings/${atDesk.bookingId}/board`).expect(200)
    ).body as CheckInResultDto;
    expect(paid.collectMinor).toBe(10_000);
    // Not paid yet: there is no ticket to board with.
    await as(owner, 'post', `/operator/bookings/${unpaid.booking.id}/board`).expect(404);

    const after = (
      await as(owner, 'get', `/operator/departures/${sunsetSlot.id}/passengers`).expect(200)
    ).body as DeparturePassengersDto;
    expect(after.departure.seatsBoarded).toBe(3);
    expect(after.passengers.find((p) => p.bookingId === hans.bookingId)?.boardedAt).toBeTruthy();
    expect(after.passengers.find((p) => p.bookingId === atDesk.bookingId)?.amountDueMinor).toBe(0);

    // Only the operator's team sees the list.
    await as(affiliateToken, 'get', `/operator/departures/${sunsetSlot.id}/passengers`).expect(403);
    await as(owner, 'get', '/operator/departures?date=6-10-2026').expect(400);
    await as(owner, 'get', `/operator/departures/${crypto.randomUUID()}/passengers`).expect(404);
  });
});
