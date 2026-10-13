import { type IncomingHttpHeaders, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  BookingDto,
  CalendarFeedDto,
  CheckoutResultDto,
  CreatedWebhookDto,
  ProductDto,
  SlotDto,
  TicketDto,
  WebhookDeliveryDto,
  WebhookEndpointDto,
  WebhookPayload,
  WebhookTestResultDto,
} from '@ap/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../src/integrations/webhook-signature';
import { WebhooksService } from '../src/integrations/webhooks.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  payload: WebhookPayload;
}

/**
 * Integrations with the operator's other software: webhooks that tell Zapier, Make or their own
 * system about bookings (signed, retried, stopped when the receiver says the address is gone), and
 * the departures calendar that Google Calendar or a phone subscribes to.
 */
describe.skipIf(!databaseUrl)('integrations (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let product: ProductDto;
  let slots: SlotDto[];
  let webhooks: WebhooksService;
  let server: Server;
  let baseUrl: string;
  const received: Received[] = [];
  /** What the receiving server answers, per path. */
  const answers = new Map<string, number>();

  const as = (token: string, method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const at = (path: string) => received.filter((r) => r.path === path);

  async function book(slot: SlotDto, email: string): Promise<CheckoutResultDto> {
    return (
      await h.http
        .post('/public/tenants/delta-boats/checkout')
        .send({
          slotId: slot.id,
          items: [{ priceId: product.prices[0]!.id, quantity: 2 }],
          acceptTerms: true,
          customer: { name: 'Ana Pop', email, phone: '+40722111222', locale: 'ro' },
        })
        .expect(201)
    ).body as CheckoutResultDto;
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
  }

  /** Runs what the worker does: domain events become webhook events, then they are sent. */
  async function work(): Promise<void> {
    await h.outbox.drain();
    await webhooks.deliverDue();
  }

  async function addWebhook(path: string, events?: string[]): Promise<CreatedWebhookDto> {
    return (
      await as(owner, 'post', '/operator/webhooks')
        .send({ url: `${baseUrl}${path}`, description: path, events })
        .expect(201)
    ).body as CreatedWebhookDto;
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const path = req.url ?? '/';
        received.push({ path, headers: req.headers, body, payload: JSON.parse(body) });
        res.statusCode = answers.get(path) ?? 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    webhooks = h.app.get(WebhooksService);
    owner = await signIn(h, h.ownerEmail);
    product = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Delta sunset',
          slug: 'sunset',
          durationMinutes: 90,
          meetingPoint: 'Pier 3, Tulcea',
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await as(owner, 'post', `/operator/products/${product.id}/slots`)
      .send({
        fromDate: '2026-10-06',
        toDate: '2026-10-06',
        times: ['10:00', '17:00'],
        capacity: 20,
      })
      .expect(201);
    slots = (
      await h.http
        .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
        .expect(200)
    ).body as SlotDto[];
  });

  afterAll(async () => {
    await h?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach(async () => {
    received.length = 0;
    answers.clear();
    h.clock.set('2026-10-05T08:00:00Z');
    // Each test starts without addresses, even when the previous one failed halfway.
    const left = (await as(owner, 'get', '/operator/webhooks').expect(200))
      .body as WebhookEndpointDto[];
    for (const endpoint of left) {
      await as(owner, 'delete', `/operator/webhooks/${endpoint.id}`).expect(204);
    }
  });

  it('sends a paid booking, signed with the address secret, with what accounting and a CRM need', async () => {
    const created = await addWebhook('/zapier');
    expect(created.secret).toMatch(/^whsec_/);
    expect(created.endpoint).toMatchObject({ url: `${baseUrl}/zapier`, active: true, events: [] });
    const revealed = (await as(owner, 'get', `/operator/webhooks/${created.endpoint.id}/secret`))
      .body as { secret: string };
    expect(revealed.secret).toBe(created.secret);

    const result = await book(slots[0]!, 'ana@example.com');
    await work();
    expect(at('/zapier')).toHaveLength(0); // not paid yet: nothing is definitive

    await pay(result);
    await work();
    const events = at('/zapier');
    expect(events.map((e) => e.payload.type).sort()).toEqual(['booking.confirmed', 'booking.paid']);

    for (const event of events) {
      const timestamp = Number(event.headers['x-webhook-timestamp']);
      expect(timestamp).toBe(Date.parse('2026-10-05T08:00:00Z') / 1000);
      expect(
        verifyWebhookSignature(
          created.secret,
          timestamp,
          event.body,
          String(event.headers['x-webhook-signature']),
          timestamp,
        ),
      ).toBe(true);
      expect(
        verifyWebhookSignature(
          'whsec_wrong',
          timestamp,
          event.body,
          String(event.headers['x-webhook-signature']),
          timestamp,
        ),
      ).toBe(false);
      expect(event.headers['x-webhook-id']).toBe(event.payload.id);
      expect(event.headers['x-webhook-event']).toBe(event.payload.type);
    }

    const paid = events.find((e) => e.payload.type === 'booking.paid')!.payload;
    expect(paid.operator).toMatchObject({
      id: h.tenantId,
      slug: 'delta-boats',
      name: 'Delta Boats',
    });
    expect(paid.data.booking).toMatchObject({
      id: result.booking.id,
      reference: result.booking.reference,
      status: 'confirmed',
      paid: true,
      paidAt: '2026-10-05T08:00:00.000Z',
      trip: { id: product.id, name: 'Delta sunset' },
      startsAt: '2026-10-06T07:00:00.000Z',
      endsAt: '2026-10-06T08:30:00.000Z',
      seats: 2,
      items: [
        {
          code: 'adult',
          label: 'Adult',
          quantity: 2,
          unitAmount: '100.00',
          unitAmountMinor: 10_000,
        },
      ],
      customer: {
        name: 'Ana Pop',
        email: 'ana@example.com',
        phone: '+40722111222',
        language: 'ro',
      },
      currency: 'RON',
      total: '200.00',
      totalMinor: 20_000,
      affiliate: null,
    });

    const history = (
      await as(owner, 'get', `/operator/webhooks/${created.endpoint.id}/deliveries`).expect(200)
    ).body as WebhookDeliveryDto[];
    expect(history.map((d) => d.status)).toEqual(['delivered', 'delivered']);

    await as(owner, 'delete', `/operator/webhooks/${created.endpoint.id}`).expect(204);
  });

  it('sends each address only the events it asked for: cancellations and boardings', async () => {
    const all = await addWebhook('/all');
    const cancels = await addWebhook('/cancels', ['booking.cancelled']);

    const boarded = await book(slots[0]!, 'boarded@example.com');
    await pay(boarded);
    const cancelled = await book(slots[1]!, 'cancelled@example.com');
    await pay(cancelled);
    await work();
    expect(at('/all')).toHaveLength(4);
    expect(at('/cancels')).toHaveLength(0);

    await as(owner, 'post', `/operator/bookings/${cancelled.booking.id}/cancel`)
      .send({ reason: 'Engine trouble' })
      .expect(200);
    const ticket = (
      await h.http.get(`/public/tickets/${boarded.booking.id}?k=${keyOf(boarded)}`).expect(200)
    ).body as TicketDto;
    h.clock.set('2026-10-06T06:50:00Z');
    await as(owner, 'post', '/operator/tickets/check-in')
      .send({ token: ticket.qrToken })
      .expect(200);
    await work();

    expect(at('/cancels').map((e) => e.payload.type)).toEqual(['booking.cancelled']);
    expect(at('/cancels')[0]!.payload.data).toMatchObject({
      booking: { id: cancelled.booking.id, status: 'refunded' },
      cancellation: { reason: 'Engine trouble', refunded: true },
    });
    const checkIn = at('/all').find((e) => e.payload.type === 'ticket.checked_in')!.payload;
    expect(checkIn.data).toMatchObject({
      booking: { id: boarded.booking.id },
      checkIn: { checkedInAt: '2026-10-06T06:50:00.000Z' },
    });

    await as(owner, 'delete', `/operator/webhooks/${all.endpoint.id}`).expect(204);
    await as(owner, 'delete', `/operator/webhooks/${cancels.endpoint.id}`).expect(204);
  });

  it('retries an address that is down, and stops for good when it answers 410 Gone', async () => {
    const flaky = await addWebhook('/flaky', ['booking.paid']);
    answers.set('/flaky', 500);
    const result = await book(slots[0]!, 'retry@example.com');
    await pay(result);
    await work();
    expect(at('/flaky')).toHaveLength(1);

    let [delivery] = (
      await as(owner, 'get', `/operator/webhooks/${flaky.endpoint.id}/deliveries`).expect(200)
    ).body as WebhookDeliveryDto[];
    expect(delivery).toMatchObject({
      status: 'pending',
      attempts: 1,
      responseStatus: 500,
      lastError: 'HTTP 500',
      nextAttemptAt: '2026-10-05T08:01:00.000Z',
    });
    const [listed] = (await as(owner, 'get', '/operator/webhooks').expect(200))
      .body as WebhookEndpointDto[];
    expect(listed).toMatchObject({ lastStatus: 500, lastError: 'HTTP 500', pending: 1 });

    // Not due yet: nothing is sent again.
    await webhooks.deliverDue();
    expect(at('/flaky')).toHaveLength(1);

    // A minute later the receiver is back.
    answers.set('/flaky', 200);
    h.clock.set('2026-10-05T08:01:00Z');
    await webhooks.deliverDue();
    expect(at('/flaky')).toHaveLength(2);
    expect(at('/flaky')[1]!.payload.id).toBe(at('/flaky')[0]!.payload.id); // same event
    [delivery] = (
      await as(owner, 'get', `/operator/webhooks/${flaky.endpoint.id}/deliveries`).expect(200)
    ).body as WebhookDeliveryDto[];
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 2 });

    // The Zap was deleted: Zapier answers 410 and the address is turned off.
    answers.set('/flaky', 410);
    const second = await book(slots[0]!, 'gone@example.com');
    await pay(second);
    await work();
    const [off] = (await as(owner, 'get', '/operator/webhooks').expect(200))
      .body as WebhookEndpointDto[];
    expect(off).toMatchObject({ active: false, lastStatus: 410, failed: 1 });
    const failed = (
      (await as(owner, 'get', `/operator/webhooks/${flaky.endpoint.id}/deliveries`).expect(200))
        .body as WebhookDeliveryDto[]
    ).find((d) => d.status === 'failed')!;

    // Turned back on and fixed: the operator sends the missed booking again.
    answers.set('/flaky', 200);
    await as(owner, 'patch', `/operator/webhooks/${flaky.endpoint.id}`)
      .send({ active: true })
      .expect(200);
    await as(
      owner,
      'post',
      `/operator/webhooks/${flaky.endpoint.id}/deliveries/${failed.id}/retry`,
    ).expect(200);
    await webhooks.deliverDue();
    const retried = (
      (await as(owner, 'get', `/operator/webhooks/${flaky.endpoint.id}/deliveries`).expect(200))
        .body as WebhookDeliveryDto[]
    ).find((d) => d.id === failed.id)!;
    expect(retried.status).toBe('delivered');

    await as(owner, 'delete', `/operator/webhooks/${flaky.endpoint.id}`).expect(204);
  });

  it('sends a test on demand and says when the address cannot be reached', async () => {
    const ok = await addWebhook('/test');
    const result = (
      await as(owner, 'post', `/operator/webhooks/${ok.endpoint.id}/test`).expect(200)
    ).body as WebhookTestResultDto;
    expect(result).toMatchObject({ ok: true, status: 200, error: null });
    expect(at('/test')[0]!.payload).toMatchObject({
      type: 'webhook.test',
      data: { booking: { reference: 'TEST-0001' } },
    });

    const down = (
      await as(owner, 'post', '/operator/webhooks')
        .send({ url: `http://127.0.0.1:${await closedPort()}/nothing-here` })
        .expect(201)
    ).body as CreatedWebhookDto;
    const failed = (
      await as(owner, 'post', `/operator/webhooks/${down.endpoint.id}/test`).expect(200)
    ).body as WebhookTestResultDto;
    expect(failed).toMatchObject({ ok: false, status: null, error: 'ECONNREFUSED' });

    await as(owner, 'delete', `/operator/webhooks/${ok.endpoint.id}`).expect(204);
    await as(owner, 'delete', `/operator/webhooks/${down.endpoint.id}`).expect(204);
  });

  it('accepts only web addresses, at most ten per operator', async () => {
    await as(owner, 'post', '/operator/webhooks').send({ url: 'ftp://example.com' }).expect(400);
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push((await addWebhook(`/n${i}`)).endpoint.id);
    const refused = await as(owner, 'post', '/operator/webhooks')
      .set('accept-language', 'ro')
      .send({ url: `${baseUrl}/n10` })
      .expect(409);
    expect(refused.body.message).toBe('poți adăuga cel mult 10 adrese de webhook');
    for (const id of ids) await as(owner, 'delete', `/operator/webhooks/${id}`).expect(204);
  });

  it('serves the departures calendar with seat counts and no customer names, until the address is changed', async () => {
    const { token } = (await as(owner, 'get', '/operator/calendar-feed').expect(200))
      .body as CalendarFeedDto;
    const again = (await as(owner, 'get', '/operator/calendar-feed').expect(200))
      .body as CalendarFeedDto;
    expect(again.token).toBe(token);

    const response = await h.http.get(`/public/calendar/${token}.ics?lang=ro`).expect(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    const ics = response.text.replace(/\r\n /g, '');
    expect(ics).toContain('X-WR-CALNAME:Delta Boats · Plecări');
    expect(ics).toContain(`UID:${slots[0]!.id}@departures`);
    expect(ics).toContain('DTSTART:20261006T070000Z');
    expect(ics).toContain('LOCATION:Pier 3\\, Tulcea');
    // Every booking so far paid on the 10:00 departure, minus the cancelled one on 17:00.
    expect(ics).toMatch(/SUMMARY:Delta sunset · \d+\/20/);
    expect(ics).toContain('Locuri ocupate:');
    expect(ics).not.toContain('Ana Pop');

    const reset = (await as(owner, 'post', '/operator/calendar-feed/reset').expect(200))
      .body as CalendarFeedDto;
    expect(reset.token).not.toBe(token);
    await h.http.get(`/public/calendar/${token}.ics`).expect(404);
    await h.http.get(`/public/calendar/${reset.token}.ics`).expect(200);
    await h.http.get(`/public/calendar/${reset.token}`).expect(404);
  });

  it('lists bookings with the contact details and VAT the spreadsheet export needs', async () => {
    const list = (
      await as(owner, 'get', '/operator/bookings?from=2026-10-06&to=2026-10-06').expect(200)
    ).body as BookingDto[];
    expect(list[0]).toMatchObject({
      customerEmail: expect.stringContaining('@example.com'),
      customerPhone: '+40722111222',
      taxMinor: expect.any(Number),
    });
  });
});
