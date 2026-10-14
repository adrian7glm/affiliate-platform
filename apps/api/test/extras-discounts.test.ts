import type {
  AffiliateDto,
  BookingDto,
  CheckoutResultDto,
  ClosePeriodResultDto,
  DiscountCodeDto,
  DiscountPreviewDto,
  EarningsDto,
  ProductDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allocate, priceBooking } from '../src/booking/pricing';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

describe('booking amounts', () => {
  const line = (amountMinor: number, quantity: number, taxRateBps = 0, commissionable = true) => ({
    price: { amountMinor, taxRateBps, seats: 1, commissionable },
    quantity,
  });

  it('splits a discount across the lines in whole units that add up', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1300, [10_000, 3000])).toEqual([1000, 300]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [10, 20])).toEqual([0, 0]);
  });

  it('takes the discount off the VAT and the commission base too', () => {
    // 2 adults at 109.00 with 9% VAT, a transfer at 30.00 without commission, 10% off.
    const amounts = priceBooking([line(10_900, 2, 900), line(3000, 1, 0, false)], {
      percentBps: 1000,
      amountMinor: null,
    });
    expect(amounts).toEqual({
      seats: 3,
      subtotalMinor: 24_800,
      discountMinor: 2480,
      totalMinor: 22_320,
      // 21 800 - 2180 = 19 620 for the tickets, VAT included: 1620.
      taxMinor: 1620,
      commissionGrossMinor: 19_620,
      commissionTaxMinor: 1620,
    });
  });

  it('never takes more than 90% off', () => {
    const amounts = priceBooking([line(5000, 1)], { percentBps: null, amountMinor: 8000 });
    expect(amounts).toMatchObject({ discountMinor: 4500, totalMinor: 500 });
    expect(priceBooking([line(5000, 1)], null)).toMatchObject({
      discountMinor: 0,
      totalMinor: 5000,
      commissionGrossMinor: 5000,
    });
  });
});

/**
 * Extras customers add to a booking (lunch, a transfer) and discount codes: the operator's own,
 * and a hotel's code that makes its guests' bookings the hotel's.
 */
describe.skipIf(!databaseUrl)('extras and discount codes (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let sunset: ProductDto;
  let delta: ProductDto;
  let slot: SlotDto;
  let ana: AffiliateDto;
  let anaToken: string;
  let maraToken: string;

  const as = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const price = (product: ProductDto, code: string) =>
    product.prices.find((p) => p.code === code)!.id;

  function checkout(items: [string, number][], discountCode?: string, lang = 'en') {
    return h.http
      .post('/public/tenants/delta-boats/checkout')
      .set('accept-language', lang)
      .send({
        slotId: slot.id,
        items: items.map(([priceId, quantity]) => ({ priceId, quantity })),
        customer: { name: 'Hans', email: 'hans@example.com', locale: 'de' },
        acceptTerms: true,
        discountCode,
      });
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function invite(name: string, phone: string): Promise<[AffiliateDto, string]> {
    const invited = (
      await as(owner, 'post', '/operator/affiliates')
        .send({ displayName: name, destination: phone })
        .expect(201)
    ).body as AffiliateDto;
    const token = await signIn(h, phone);
    await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${token}`)
      .send({ token: invited.inviteUrl!.split('/join/')[1]!, name })
      .expect(201);
    return [invited, token];
  }

  const createCode = (body: object) => as(owner, 'post', '/operator/discount-codes').send(body);

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    await as(owner, 'post', '/operator/commission-plans')
      .send({ kind: 'fixed', name: 'Standard', rateBps: 1000, isDefault: true })
      .expect(201);
    sunset = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Plimbare la apus',
          slug: 'sunset',
          durationMinutes: 90,
          prices: [
            { code: 'adult', label: 'Adult', amountMinor: 10_000 },
            { code: 'copil', label: 'Copil', amountMinor: 5000 },
            { code: 'pranz', label: 'Prânz', amountMinor: 4000, kind: 'extra', seats: 2 },
            {
              code: 'transfer',
              label: 'Transfer de la hotel',
              amountMinor: 3000,
              kind: 'extra',
              commissionable: false,
            },
          ],
        })
        .expect(201)
    ).body as ProductDto;
    delta = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Delta',
          slug: 'delta',
          durationMinutes: 480,
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 40_000 }],
        })
        .expect(201)
    ).body as ProductDto;
    await as(owner, 'post', `/operator/products/${sunset.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-10-06', times: ['10:00'], capacity: 20 })
      .expect(201);
    slot = (
      (
        await h.http
          .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
          .expect(200)
      ).body as SlotDto[]
    )[0]!;
    [ana, anaToken] = await invite('Ana, Hotel Central', '+40722000101');
    [, maraToken] = await invite('Hotel Mara', '+40722000102');
  });

  afterAll(async () => {
    await h?.close();
  });

  it('sells extras with the tickets: they take no seat and a booking needs a ticket', async () => {
    expect(sunset.prices.map((p) => [p.code, p.kind, p.seats, p.commissionable])).toEqual([
      ['adult', 'ticket', 1, true],
      ['copil', 'ticket', 1, true],
      ['pranz', 'extra', 0, true],
      ['transfer', 'extra', 0, false],
    ]);
    // "From" prices count tickets only, not the cheaper transfer.
    expect(sunset.fromMinor).toBe(5000);
    await as(owner, 'post', '/operator/products')
      .send({
        name: 'Only lunch',
        slug: 'lunch',
        durationMinutes: 60,
        prices: [{ code: 'pranz', label: 'Prânz', amountMinor: 4000, kind: 'extra' }],
      })
      .expect(400);
    await checkout([[price(sunset, 'pranz'), 2]]).expect(400);

    const result = (
      await checkout([
        [price(sunset, 'adult'), 2],
        [price(sunset, 'pranz'), 2],
      ]).expect(201)
    ).body as CheckoutResultDto;
    expect(result.booking).toMatchObject({
      seats: 2,
      totalMinor: 28_000,
      discountCode: null,
      discountMinor: 0,
    });
    // The payment page lists each line.
    expect(h.payments.checkouts.at(-1)!.lines.map((l) => [l.unitAmountMinor, l.quantity])).toEqual([
      [10_000, 2],
      [4000, 2],
    ]);
    await pay(result);
    const ticket = (
      await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200)
    ).body as TicketDto;
    expect(ticket.items).toEqual([
      { label: 'Adult', quantity: 2 },
      { label: 'Prânz', quantity: 2 },
    ]);
    expect(ticket.seats).toBe(2);
  });

  it('takes a code off the booking and shows the customer the new price first', async () => {
    const code = (await createCode({ code: ' vara10 ', percentBps: 1000 }).expect(201))
      .body as DiscountCodeDto;
    expect(code).toMatchObject({ code: 'VARA10', affiliateId: null, uses: 0, active: true });

    const preview = (
      await h.http
        .get(`/public/tenants/delta-boats/discount-codes/Vara10?productId=${sunset.id}`)
        .expect(200)
    ).body as DiscountPreviewDto;
    expect(preview).toEqual({ code: 'VARA10', percentBps: 1000, amountMinor: null });

    const result = (
      await checkout(
        [
          [price(sunset, 'adult'), 1],
          [price(sunset, 'pranz'), 1],
        ],
        'vara10',
      ).expect(201)
    ).body as CheckoutResultDto;
    expect(result.booking).toMatchObject({
      totalMinor: 12_600,
      discountCode: 'VARA10',
      discountMinor: 1400,
      channel: 'direct',
      affiliateName: null,
    });
    // The payment page can't show the discount line by line: one line with the total.
    const opened = h.payments.checkouts.at(-1)!;
    expect(opened.totalMinor).toBe(12_600);
    expect(opened.lines).toHaveLength(1);
    expect(opened.lines[0]).toMatchObject({ unitAmountMinor: 12_600, quantity: 1 });
    expect(opened.lines[0]!.name).toContain('VARA10');
    await pay(result);

    const [listed] = (await as(owner, 'get', '/operator/discount-codes').expect(200))
      .body as DiscountCodeDto[];
    expect(listed).toMatchObject({ code: 'VARA10', uses: 1, revenueMinor: 12_600 });
  });

  it('refuses a code that does not apply, saying why in the customer language', async () => {
    const reason = async (code: string, productId = sunset.id) => {
      const response = await h.http
        .get(`/public/tenants/delta-boats/discount-codes/${code}?productId=${productId}`)
        .set('accept-language', 'ro');
      expect(response.status).toBe(400);
      return response.body.code as string;
    };
    expect(await reason('NOPE')).toBe('errors.discounts.invalid');

    await createCode({ code: 'DELTA20', percentBps: 2000, productIds: [delta.id] }).expect(201);
    expect(await reason('DELTA20')).toBe('errors.discounts.notForTrip');
    await h.http
      .get(`/public/tenants/delta-boats/discount-codes/DELTA20?productId=${delta.id}`)
      .expect(200);

    // Valid from tomorrow in Bucharest (it is 11:00 on 5 October there).
    await createCode({ code: 'MAINE', amountMinor: 1000, validFrom: '2026-10-06' }).expect(201);
    expect(await reason('MAINE')).toBe('errors.discounts.notToday');
    await createCode({ code: 'IERI', amountMinor: 1000, validUntil: '2026-10-04' }).expect(201);
    expect(await reason('IERI')).toBe('errors.discounts.notToday');

    const paused = (await createCode({ code: 'PAUZA', percentBps: 500 }).expect(201))
      .body as DiscountCodeDto;
    await as(owner, 'patch', `/operator/discount-codes/${paused.id}`)
      .send({ active: false })
      .expect(200);
    expect(await reason('PAUZA')).toBe('errors.discounts.invalid');

    // The checkout refuses it too, in the customer's language.
    const refused = await checkout([[price(sunset, 'adult'), 1]], 'PAUZA', 'ro').expect(400);
    expect(refused.body.message).toBe('codul de reducere nu există sau nu mai e valabil');

    // Codes are unique per operator whatever the case; a percentage and an amount don't mix.
    await createCode({ code: 'vara10', percentBps: 500 }).expect(409);
    await createCode({ code: 'BOTH', percentBps: 500, amountMinor: 100 }).expect(400);
    await createCode({ code: 'NONE' }).expect(400);
    await createCode({ code: 'X', percentBps: 500 }).expect(400);
    await createCode({ code: 'MULT', percentBps: 9500 }).expect(400);
    await createCode({
      code: 'DATES',
      percentBps: 500,
      validFrom: '2026-10-10',
      validUntil: '2026-10-01',
    }).expect(400);
  });

  it('counts the uses of a limited code, and a cancelled booking gives its use back', async () => {
    const code = (await createCode({ code: 'UNU', amountMinor: 2000, maxUses: 1 }).expect(201))
      .body as DiscountCodeDto;
    const first = (await checkout([[price(sunset, 'adult'), 1]], 'UNU').expect(201))
      .body as CheckoutResultDto;
    expect(first.booking).toMatchObject({ totalMinor: 8000, discountMinor: 2000 });

    // Waiting for payment, the booking holds the code's only use.
    const usedUp = await checkout([[price(sunset, 'adult'), 1]], 'UNU').expect(400);
    expect(usedUp.body.code).toBe('errors.discounts.usedUp');

    await as(owner, 'post', `/operator/bookings/${first.booking.id}/cancel`)
      .send({ reason: 'customer changed plans' })
      .expect(200);
    await checkout([[price(sunset, 'adult'), 1]], 'UNU').expect(201);
    const listed = (
      (await as(owner, 'get', '/operator/discount-codes').expect(200)).body as DiscountCodeDto[]
    ).find((c) => c.id === code.id)!;
    expect(listed).toMatchObject({ uses: 1, maxUses: 1, revenueMinor: 0 });

    // Changing a code: the amount replaces the percentage and the other way round.
    const changed = (
      await as(owner, 'patch', `/operator/discount-codes/${code.id}`)
        .send({ percentBps: 1500, maxUses: null })
        .expect(200)
    ).body as DiscountCodeDto;
    expect(changed).toMatchObject({ percentBps: 1500, amountMinor: null, maxUses: null });
  });

  it("makes a hotel's code bring it the booking, with commission on what the guest paid", async () => {
    const code = (
      await createCode({ code: 'CENTRAL', percentBps: 1000, affiliateId: ana.id }).expect(201)
    ).body as DiscountCodeDto;
    expect(code.affiliateName).toBe('Ana, Hotel Central');
    // Ana sees her code to hand out; another affiliate doesn't.
    const own = (await as(anaToken, 'get', '/affiliate/discount-codes').expect(200))
      .body as DiscountCodeDto[];
    expect(own.map((c) => c.code)).toEqual(['CENTRAL']);
    expect((await as(maraToken, 'get', '/affiliate/discount-codes').expect(200)).body).toEqual([]);

    // The guest books alone, on the public page: an adult and the transfer (no commission on it).
    const result = (
      await checkout(
        [
          [price(sunset, 'adult'), 1],
          [price(sunset, 'transfer'), 1],
        ],
        'central',
      ).expect(201)
    ).body as CheckoutResultDto;
    expect(result.booking).toMatchObject({
      channel: 'promo_code',
      affiliateName: 'Ana, Hotel Central',
      totalMinor: 11_700,
      discountMinor: 1300,
    });
    await pay(result);
    let earnings = (await as(anaToken, 'get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    // 10% of the adult ticket after its share of the discount (10 000 - 1000).
    expect(earnings.entries.map((e) => [e.baseMinor, e.rateBps, e.amountMinor])).toEqual([
      [9000, 1000, 900],
    ]);

    // Ana books for a guest at her desk with her own code; Mara can't use Ana's.
    const assisted = (
      await as(anaToken, 'post', '/affiliate/bookings')
        .send({
          slotId: slot.id,
          items: [{ priceId: price(sunset, 'adult'), quantity: 1 }],
          customer: { name: 'Guest', phone: '+40733000000', locale: 'ro' },
          payment: 'on_site',
          discountCode: 'CENTRAL',
        })
        .expect(201)
    ).body as CheckoutResultDto;
    expect(assisted.booking).toMatchObject({
      channel: 'affiliate_assisted',
      totalMinor: 9000,
      discountCode: 'CENTRAL',
    });
    const refused = await as(maraToken, 'post', '/affiliate/bookings')
      .send({
        slotId: slot.id,
        items: [{ priceId: price(sunset, 'adult'), quantity: 1 }],
        customer: { name: 'Guest', phone: '+40733000001', locale: 'ro' },
        discountCode: 'CENTRAL',
      })
      .expect(400);
    expect(refused.body.code).toBe('errors.discounts.otherAffiliate');
    // The operator's own codes work for any affiliate.
    await as(maraToken, 'post', '/affiliate/bookings')
      .send({
        slotId: slot.id,
        items: [{ priceId: price(sunset, 'adult'), quantity: 1 }],
        customer: { name: 'Guest', phone: '+40733000002', locale: 'ro' },
        discountCode: 'VARA10',
      })
      .expect(201);

    // The month close recomputes from the same base: nothing to adjust.
    h.clock.set('2026-11-01T10:00:00Z');
    const closed = (
      await as(owner, 'post', '/operator/payouts/close-period')
        .send({ periodKey: '2026-10' })
        .expect(200)
    ).body as ClosePeriodResultDto;
    expect(closed.adjustmentsCreated).toBe(0);
    earnings = (await as(anaToken, 'get', '/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    expect(earnings.totalMinor).toBe(900);
    h.clock.set('2026-10-05T08:00:00Z');

    const bookings = (
      await as(owner, 'get', '/operator/bookings?from=2026-10-06&to=2026-10-06').expect(200)
    ).body as BookingDto[];
    expect(bookings.find((b) => b.id === result.booking.id)).toMatchObject({
      discountCode: 'CENTRAL',
      discountMinor: 1300,
    });

    // A suspended hotel's code stops working.
    await as(owner, 'patch', `/operator/affiliates/${ana.id}`)
      .send({ status: 'suspended' })
      .expect(200);
    const stopped = await checkout([[price(sunset, 'adult'), 1]], 'CENTRAL').expect(400);
    expect(stopped.body.code).toBe('errors.discounts.invalid');
  });
});
