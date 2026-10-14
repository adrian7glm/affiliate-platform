import type {
  AffiliateDto,
  AffiliateHomeDto,
  BookingDto,
  CheckoutResultDto,
  EarningsDto,
  ProductDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { auditLog, createDb, payments, processedWebhookEvents, tenants } from '@ap/db';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StripeGateway } from '../src/payments/stripe.gateway';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

const WEBHOOK_SECRET = 'whsec_test_secret';
const CONNECTED_ACCOUNT = 'acct_operator_test';

/**
 * Online payments through the real Stripe gateway and webhook endpoint. Only the two calls that
 * would reach Stripe's servers (create a Checkout Session, create a refund) are replaced; the
 * webhook signatures are real, made with the same code Stripe uses.
 */
describe.skipIf(!databaseUrl)('Stripe payments end to end (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let gateway: StripeGateway;
  let owner: string;
  let affiliateToken: string;
  let product: ProductDto;
  let slot: SlotDto;
  let linkCode: string;
  let sessions: Stripe.Checkout.SessionCreateParams[];
  let sessionOptions: Stripe.RequestOptions[];
  let refunds: { params: Stripe.RefundCreateParams; options: Stripe.RequestOptions }[];
  let eventNumber = 0;

  const asOwner = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const asAffiliate = (path: string) =>
    h.http
      .get(path)
      .set('authorization', `Bearer ${affiliateToken}`)
      .set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const ticketOf = async (result: CheckoutResultDto) =>
    (await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200))
      .body as TicketDto;
  const intentOf = (result: CheckoutResultDto) => `pi_${result.booking.reference}`;

  async function book(adults: number, email: string, ref?: string): Promise<CheckoutResultDto> {
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: product.prices[0]!.id, quantity: adults }],
        acceptTerms: true,
        customer: { name: 'Card customer', email, locale: 'en' },
        ref,
      })
      .expect(201);
    return response.body as CheckoutResultDto;
  }

  /** Delivers an event to the webhook endpoint the way Stripe does, signature included. */
  function deliver(type: string, object: Record<string, unknown>, id = `evt_${++eventNumber}`) {
    const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
    const signature = gateway.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return h.http
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  const sessionCompleted = (result: CheckoutResultDto, paymentStatus = 'paid') => ({
    id: `cs_test_${result.booking.id}`,
    object: 'checkout.session',
    client_reference_id: result.booking.id,
    metadata: { bookingId: result.booking.id },
    payment_status: paymentStatus,
    payment_intent: intentOf(result),
  });

  async function payWithStripe(result: CheckoutResultDto): Promise<void> {
    await deliver('checkout.session.completed', sessionCompleted(result)).expect(200);
    await h.outbox.drain();
  }

  async function earningsFor(result: CheckoutResultDto) {
    const earnings = (await asAffiliate('/affiliate/earnings?period=2026-10').expect(200))
      .body as EarningsDto;
    return earnings.entries
      .filter((e) => e.bookingReference === result.booking.reference)
      .map((e) => [e.kind, e.amountMinor]);
  }

  async function paymentRow(result: CheckoutResultDto) {
    const handle = createDb(databaseUrl!, { max: 1 });
    const [row] = await handle.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, result.booking.id));
    await handle.close();
    return row!;
  }

  beforeAll(async () => {
    h = await startHarness(
      databaseUrl!,
      '2026-10-05T08:00:00Z',
      {
        PAYMENTS_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      },
      (config) => {
        gateway = new StripeGateway(config);
        return gateway;
      },
    );
    sessions = [];
    sessionOptions = [];
    refunds = [];
    gateway.stripe.checkout.sessions.create = vi.fn(
      async (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
        sessions.push(params);
        sessionOptions.push(options ?? {});
        const id = `cs_test_${params.client_reference_id}`;
        return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
      },
    ) as never;
    gateway.stripe.refunds.create = vi.fn(
      async (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => {
        refunds.push({ params, options: options ?? {} });
        return { id: `re_${refunds.length}` };
      },
    ) as never;

    // The operator has connected their Stripe account: they are the merchant, the platform takes its fee.
    const handle = createDb(databaseUrl!, { max: 1 });
    await handle.db
      .update(tenants)
      .set({ stripeAccountId: CONNECTED_ACCOUNT })
      .where(eq(tenants.id, h.tenantId));
    await handle.close();

    owner = await signIn(h, h.ownerEmail);
    await asOwner('post', '/operator/commission-plans')
      .send({
        kind: 'tiered',
        name: 'Flat',
        mode: 'marginal',
        tiers: [{ fromSale: 1, rateBps: 1000 }],
      })
      .expect(201);
    product = (
      await asOwner('post', '/operator/products')
        .send({
          name: 'Sunset cruise',
          slug: 'sunset',
          durationMinutes: 90,
          meetingPoint: 'Pier 3',
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await asOwner('post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-10-06', times: ['18:00'], capacity: 10 })
      .expect(201);
    slot = (
      (
        await h.http
          .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
          .expect(200)
      ).body as SlotDto[]
    )[0]!;

    const phone = '+40722000555';
    const affiliate = (
      await asOwner('post', '/operator/affiliates')
        .send({ displayName: 'Hotel Central', destination: phone })
        .expect(201)
    ).body as AffiliateDto;
    affiliateToken = await signIn(h, phone);
    await h.http
      .post('/invites/accept')
      .set('authorization', `Bearer ${affiliateToken}`)
      .send({ token: affiliate.inviteUrl!.split('/join/')[1], name: 'Ana' })
      .expect(201);
    linkCode = ((await asAffiliate('/affiliate/home').expect(200)).body as AffiliateHomeDto)
      .primaryLink.code;
  });

  afterAll(async () => {
    await h?.close();
  });

  it("opens a Stripe Checkout on the operator's account, with the platform fee", async () => {
    const result = await book(2, 'one@example.com', linkCode);
    expect(result.paymentUrl).toBe(
      `https://checkout.stripe.com/c/pay/cs_test_${result.booking.id}`,
    );
    expect(result.booking).toMatchObject({ status: 'pending_payment', channel: 'link' });

    const params = sessions.at(-1)!;
    expect(params).toMatchObject({
      mode: 'payment',
      client_reference_id: result.booking.id,
      customer_email: 'one@example.com',
      locale: 'en',
      line_items: [
        {
          quantity: 2,
          price_data: {
            currency: 'ron',
            unit_amount: 10_000,
            product_data: { name: 'Sunset cruise · Adult' },
          },
        },
      ],
      payment_intent_data: {
        on_behalf_of: CONNECTED_ACCOUNT,
        transfer_data: { destination: CONNECTED_ACCOUNT },
        // 3% of 200.00 RON.
        application_fee_amount: 600,
      },
    });
    expect(params.success_url).toBe(result.ticketUrl);
    // Never two Checkout Sessions (and two charges) for one booking, even if the request is retried.
    expect(sessionOptions.at(-1)).toEqual({ idempotencyKey: `checkout-${result.booking.id}` });
    expect(await paymentRow(result)).toMatchObject({
      provider: 'stripe',
      checkoutSessionId: `cs_test_${result.booking.id}`,
      amountMinor: 20_000,
      status: 'requires_payment',
    });

    // No QR code before the money arrives.
    expect(await ticketOf(result)).toMatchObject({ status: 'pending_payment', qrToken: null });
  });

  it('refuses webhook calls that Stripe did not sign', async () => {
    const result = await book(1, 'forger@example.com');
    const payload = JSON.stringify({
      id: 'evt_forged',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: sessionCompleted(result) },
    });
    await h.http
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(payload)
      .expect(400);
    await h.http
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(payload)
      .expect(400);
    const signedWithAnotherSecret = gateway.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_someone_else',
    });
    await h.http
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', signedWithAnotherSecret)
      .send(payload)
      .expect(400);
    expect(await ticketOf(result)).toMatchObject({ status: 'pending_payment', qrToken: null });
  });

  it('confirms the booking once when Stripe says it is paid, and records the commission', async () => {
    const result = await book(2, 'paid@example.com', linkCode);
    await deliver('checkout.session.completed', sessionCompleted(result), 'evt_paid').expect(200);
    await h.outbox.drain();

    const ticket = await ticketOf(result);
    expect(ticket.status).toBe('valid');
    expect(ticket.qrToken).toMatch(/^t1\./);
    expect(await paymentRow(result)).toMatchObject({
      status: 'succeeded',
      paymentIntentId: intentOf(result),
    });
    // 10% of 200.00 RON.
    expect(await earningsFor(result)).toEqual([['sale', 2_000]]);

    // Stripe redelivers the event, and also sends the "async succeeded" one: still one sale.
    await deliver('checkout.session.completed', sessionCompleted(result), 'evt_paid').expect(200);
    await deliver('checkout.session.async_payment_succeeded', sessionCompleted(result)).expect(200);
    await h.outbox.drain();
    expect(await earningsFor(result)).toEqual([['sale', 2_000]]);
    const sent = await h.lastMessage('paid@example.com');
    expect(sent?.text).toContain(result.booking.reference);
    expect(h.messages.sent.filter((m) => m.to === 'paid@example.com')).toHaveLength(1);
  });

  it('waits for bank transfers and other delayed payment methods', async () => {
    const result = await book(1, 'delayed@example.com');
    await deliver('checkout.session.completed', sessionCompleted(result, 'unpaid')).expect(200);
    expect(await ticketOf(result)).toMatchObject({ status: 'pending_payment', qrToken: null });

    await deliver('checkout.session.async_payment_succeeded', sessionCompleted(result)).expect(200);
    // Paid; the ticket itself is issued right after: the page keeps saying it is confirming.
    expect(await ticketOf(result)).toMatchObject({ status: 'pending_payment', qrToken: null });
    await h.outbox.drain();
    expect((await ticketOf(result)).status).toBe('valid');
  });

  it('acknowledges payments of the same Stripe account that are not bookings', async () => {
    // A payment link or invoice of the operator: no booking id, or an id of something else.
    // An error here would make Stripe retry the event for three days and flag the endpoint.
    const other = (id: string | null) => ({
      id: 'cs_test_other',
      object: 'checkout.session',
      client_reference_id: id,
      metadata: {},
      payment_status: 'paid',
      payment_intent: 'pi_other',
    });
    await deliver('checkout.session.completed', other(null)).expect(200);
    await deliver('checkout.session.completed', other('order-1234')).expect(200);
    await deliver(
      'checkout.session.completed',
      other('5b0e6f53-6a43-4a3f-9d43-8f2b6f0a1c11'),
      'evt_unknown_booking',
    ).expect(200);
    await deliver('charge.refunded', {
      id: 'ch_other',
      object: 'charge',
      payment_intent: 'pi_other',
      amount: 5_000,
      amount_refunded: 5_000,
    }).expect(200);

    const handle = createDb(databaseUrl!, { max: 1 });
    const [seen] = await handle.db
      .select()
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.id, 'evt_unknown_booking'));
    await handle.close();
    expect(seen).toBeDefined();
  });

  it('refunds through Stripe, taking the money back from the operator, when a booking is cancelled', async () => {
    const result = await book(2, 'cancel@example.com', linkCode);
    await payWithStripe(result);
    const before = refunds.length;

    const cancelled = (
      await asOwner('post', `/operator/bookings/${result.booking.id}/cancel`)
        .send({ reason: 'customer is ill' })
        .expect(200)
    ).body as BookingDto;
    expect(cancelled.status).toBe('refunded');
    expect(refunds.slice(before)).toEqual([
      {
        params: {
          payment_intent: intentOf(result),
          amount: 20_000,
          reverse_transfer: true,
          refund_application_fee: true,
        },
        options: { idempotencyKey: `refund-${intentOf(result)}-20000` },
      },
    ]);

    // Stripe then reports the refund it made: nothing is refunded twice.
    await deliver('charge.refunded', {
      id: `ch_${result.booking.reference}`,
      object: 'charge',
      payment_intent: intentOf(result),
      amount: 20_000,
      amount_refunded: 20_000,
    }).expect(200);
    await h.outbox.drain();
    expect(refunds.length).toBe(before + 1);
    expect(await earningsFor(result)).toEqual(
      expect.arrayContaining([
        ['sale', 2_000],
        ['reversal', -2_000],
      ]),
    );
    expect(await earningsFor(result)).toHaveLength(2);
  });

  it('cancels the ticket and the commission when the operator refunds in the Stripe dashboard', async () => {
    const result = await book(3, 'dashboard@example.com', linkCode);
    await payWithStripe(result);
    const ticket = await ticketOf(result);
    const before = refunds.length;
    const available = async () =>
      (
        (
          await h.http
            .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
            .expect(200)
        ).body as SlotDto[]
      )[0]!.available;
    const seatsBefore = await available();

    await deliver('charge.refunded', {
      id: `ch_${result.booking.reference}`,
      object: 'charge',
      payment_intent: intentOf(result),
      amount: 30_000,
      amount_refunded: 30_000,
    }).expect(200);
    await h.outbox.drain();

    expect(refunds.length).toBe(before);
    expect(await ticketOf(result)).toMatchObject({ status: 'void', qrToken: null });
    expect(await paymentRow(result)).toMatchObject({ status: 'refunded', refundedMinor: 30_000 });
    expect(await available()).toBe(seatsBefore + 3);
    expect(await earningsFor(result)).toEqual(
      expect.arrayContaining([
        ['sale', 3_000],
        ['reversal', -3_000],
      ]),
    );
    const scan = await asOwner('post', '/operator/tickets/check-in')
      .send({ token: ticket.qrToken })
      .expect(200);
    expect(scan.body.result).toBe('not_valid');
    const notice = await h.lastMessage('dashboard@example.com');
    expect(notice?.subject).toContain(result.booking.reference);
    expect(notice?.text).toContain('refund');
  });

  it('only records a partial refund made in the Stripe dashboard', async () => {
    const result = await book(2, 'partial@example.com');
    await payWithStripe(result);

    await deliver('charge.refunded', {
      id: `ch_${result.booking.reference}`,
      object: 'charge',
      payment_intent: intentOf(result),
      amount: 20_000,
      amount_refunded: 5_000,
    }).expect(200);

    expect((await ticketOf(result)).status).toBe('valid');
    expect(await paymentRow(result)).toMatchObject({ status: 'succeeded', refundedMinor: 5_000 });
    const handle = createDb(databaseUrl!, { max: 1 });
    const audit = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.booking.id));
    await handle.close();
    expect(audit.map((a) => a.action)).toContain('partial_refund_in_stripe');
  });
});
