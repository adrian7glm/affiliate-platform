import type {
  CancelDeparturesResultDto,
  CheckoutResultDto,
  ContactRequestDto,
  OperatorSettingsDto,
  ProductDto,
  PublicTenantDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { bookings, contactRequests, createDb, payments } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * What an operator needs before selling to real customers: booking terms the customer accepts,
 * their cancellation policy and contact details, calling off a day when the weather turns (every
 * passenger refunded and told why), "add to calendar" on the ticket, and the contact page.
 */
describe.skipIf(!databaseUrl)('launch essentials (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let admin: string;
  let product: ProductDto;
  let slots: SlotDto[];
  const adminEmail = 'boss@platform.test';
  const policy = 'Free cancellation up to 24 hours before departure.';

  const as = (token: string, method: 'get' | 'post' | 'patch', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;

  async function book(slot: SlotDto, email: string, locale = 'ro'): Promise<CheckoutResultDto> {
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: product.prices[0]!.id, quantity: 2 }],
        acceptTerms: true,
        customer: { name: 'Ana Pop', email, locale },
      })
      .expect(201);
    return response.body as CheckoutResultDto;
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', {
      PLATFORM_ADMIN_EMAILS: adminEmail,
    });
    owner = await signIn(h, h.ownerEmail);
    admin = await signIn(h, adminEmail);
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
  });

  it('refuses a booking whose customer did not accept the terms, and records when they did', async () => {
    await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slots[0]!.id,
        items: [{ priceId: product.prices[0]!.id, quantity: 1 }],
        customer: { name: 'Ana Pop', email: 'no-terms@example.com', locale: 'en' },
      })
      .expect(400);

    const result = await book(slots[0]!, 'terms@example.com');
    const handle = createDb(databaseUrl!, { max: 1 });
    const [row] = await handle.db
      .select({ termsAcceptedAt: bookings.termsAcceptedAt })
      .from(bookings)
      .where(eq(bookings.id, result.booking.id));
    await handle.close();
    expect(row?.termsAcceptedAt?.toISOString()).toBe('2026-10-05T08:00:00.000Z');
  });

  it('shows the cancellation policy and contact details on the booking page and the ticket', async () => {
    const settings = (
      await as(owner, 'patch', '/operator/settings')
        .send({
          cancellationPolicy: policy,
          contactEmail: 'Hello@Delta.test',
          contactPhone: '+40722000111',
        })
        .expect(200)
    ).body as OperatorSettingsDto;
    expect(settings).toMatchObject({
      cancellationPolicy: policy,
      contactEmail: 'hello@delta.test',
      contactPhone: '+40722000111',
    });

    const tenant = (await h.http.get('/public/tenants/delta-boats').expect(200))
      .body as PublicTenantDto;
    expect(tenant.cancellationPolicy).toBe(policy);
    expect(tenant.contactEmail).toBe('hello@delta.test');

    const result = await book(slots[0]!, 'policy@example.com');
    const ticket = (
      await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200)
    ).body as TicketDto;
    expect(ticket).toMatchObject({
      cancellationPolicy: policy,
      contactPhone: '+40722000111',
      startsAt: '2026-10-06T07:00:00.000Z',
      endsAt: '2026-10-06T08:30:00.000Z',
    });

    // Back to the platform's default text.
    await as(owner, 'patch', '/operator/settings').send({ cancellationPolicy: null }).expect(200);
    const after = (await h.http.get('/public/tenants/delta-boats').expect(200))
      .body as PublicTenantDto;
    expect(after.cancellationPolicy).toBeNull();
  });

  it('adds a confirmed trip to the calendar: .ics download, attachment and Google link', async () => {
    const email = 'calendar@example.com';
    const result = await book(slots[0]!, email, 'en');
    const icsPath = `/public/tickets/${result.booking.id}/calendar.ics?k=${keyOf(result)}`;
    // Not paid yet: nothing to put in a calendar.
    await h.http.get(icsPath).expect(409);
    await h.http.get(`/public/tickets/${result.booking.id}/calendar.ics?k=wrong`).expect(404);

    await pay(result);
    const response = await h.http.get(icsPath).expect(200);
    expect(response.headers['content-type']).toContain('text/calendar');
    expect(response.headers['content-disposition']).toContain(`${result.booking.reference}.ics`);
    const ics = response.text;
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20261006T070000Z');
    expect(ics).toContain('DTEND:20261006T083000Z');
    expect(ics).toContain('SUMMARY:Delta sunset · Delta Boats');
    expect(ics).toContain('LOCATION:Pier 3\\, Tulcea');
    expect(ics).toContain('TRIGGER:-PT120M');
    expect(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);

    const sent = await h.lastMessage(email);
    expect(sent?.subject).toContain('Delta sunset');
    const attachment = sent?.attachments?.find((a) => a.filename.endsWith('.ics'));
    expect(attachment?.contentType).toContain('text/calendar');
    expect(attachment?.content.toString()).toContain('DTSTART:20261006T070000Z');
    expect(sent?.html).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE');
    expect(sent?.text).toContain('Add to Google Calendar: https://calendar.google.com/');
  });

  it('calls off a departure for bad weather: closes it, refunds and tells every passenger', async () => {
    const evening = slots[1]!;
    const paid = await book(evening, 'paid@example.com');
    await pay(paid);
    const unpaid = await book(evening, 'unpaid@example.com');
    const refundsBefore = h.payments.refunds.length;

    const result = (
      await as(owner, 'post', `/operator/products/${product.id}/slots/cancel`)
        .send({
          slotIds: [evening.id],
          reason: 'weather',
          message: 'Reply to this email and we move you to tomorrow.',
        })
        .expect(200)
    ).body as CancelDeparturesResultDto;
    expect(result).toMatchObject({ cancelled: 2, refunded: 1, failed: 0 });
    expect(result.slots).toEqual([expect.objectContaining({ id: evening.id, closed: true })]);
    expect(result.slots[0]!.reserved).toBe(0);
    expect(h.payments.refunds.length).toBe(refundsBefore + 1);

    const sent = await h.lastMessage('paid@example.com');
    expect(sent?.subject).toContain(paid.booking.reference);
    expect(sent?.text).toContain('din cauza vremii');
    expect(sent?.text).toContain('Reply to this email and we move you to tomorrow.');
    expect(sent?.text).toContain('returnați pe card');

    // The departure no longer sells.
    const open = (
      await h.http
        .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
        .expect(200)
    ).body as SlotDto[];
    expect(open.find((s) => s.id === evening.id)?.available ?? 0).toBe(0);

    // The customer who was still on the payment page pays anyway: the money goes straight back.
    await h.http
      .post(`/public/dev-payments/${unpaid.booking.id}/succeed?k=${keyOf(unpaid)}`)
      .expect(204);
    expect(h.payments.refunds.length).toBe(refundsBefore + 2);
    const handle = createDb(databaseUrl!, { max: 1 });
    const [payment] = await handle.db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, unpaid.booking.id));
    await handle.close();
    expect(payment).toMatchObject({ status: 'refunded', refundedMinor: 20_000 });

    // Calling it off again changes nothing.
    const again = (
      await as(owner, 'post', `/operator/products/${product.id}/slots/cancel`)
        .send({ slotIds: [evening.id], reason: 'weather' })
        .expect(200)
    ).body as CancelDeparturesResultDto;
    expect(again).toMatchObject({ cancelled: 0, refunded: 0, failed: 0 });
  });

  it('does not call off a departure that has already left', async () => {
    h.clock.set('2026-10-06T07:30:00Z');
    try {
      const response = await as(owner, 'post', `/operator/products/${product.id}/slots/cancel`)
        .send({ slotIds: [slots[0]!.id], reason: 'weather' })
        .expect(409);
      expect(response.body.code).toBe('errors.departures.alreadyStarted');
    } finally {
      h.clock.set('2026-10-05T08:00:00Z');
    }
  });

  it('refuses departures of another trip', async () => {
    const other = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Other trip',
          slug: 'other',
          durationMinutes: 60,
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 5_000 }],
        })
        .expect(201)
    ).body as ProductDto;
    const response = await as(owner, 'post', `/operator/products/${other.id}/slots/cancel`).send({
      slotIds: [slots[0]!.id],
      reason: 'other',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const ticketSlot = (
      await h.http
        .get('/public/tenants/delta-boats/products/sunset/slots?from=2026-10-06&to=2026-10-06')
        .expect(200)
    ).body as SlotDto[];
    expect(ticketSlot.find((s) => s.id === slots[0]!.id)?.available).toBeGreaterThan(0);
  });

  it('takes contact page messages, emails the platform owner and lists them in the admin area', async () => {
    await h.http
      .post('/public/contact')
      .send({
        topic: 'demo',
        name: 'Mihai Ionescu',
        email: 'Mihai@Boats.test',
        phone: '+40733000222',
        company: 'Danube Tours',
        message: 'We have 3 boats and 20 hotel partners.',
        locale: 'ro',
      })
      .expect(204);
    const mail = await h.lastMessage(adminEmail);
    expect(mail?.subject).toBe('Cerere de demo de la Mihai Ionescu');
    expect(mail?.text).toContain('We have 3 boats and 20 hotel partners.');
    expect(mail?.text).toContain('mihai@boats.test');

    // A bot fills in the hidden field: accepted quietly, nothing kept.
    await h.http
      .post('/public/contact')
      .send({ topic: 'question', name: 'Bot', email: 'bot@spam.test', website: 'http://spam' })
      .expect(204);
    // Bad email.
    await h.http
      .post('/public/contact')
      .send({ topic: 'question', name: 'X', email: 'not-an-email' })
      .expect(400);
    // Three per hour from one address.
    for (let i = 0; i < 2; i += 1) {
      await h.http
        .post('/public/contact')
        .send({ topic: 'question', name: 'Mihai', email: 'mihai@boats.test', message: `Q${i}` })
        .expect(204);
    }
    const tooMany = await h.http
      .post('/public/contact')
      .send({ topic: 'question', name: 'Mihai', email: 'mihai@boats.test', message: 'Q3' })
      .expect(429);
    expect(tooMany.body.code).toBe('errors.contact.tooMany');

    await as(owner, 'get', '/admin/contact-requests').expect(403);
    const list = (await as(admin, 'get', '/admin/contact-requests').expect(200))
      .body as ContactRequestDto[];
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ topic: 'demo', company: 'Danube Tours', handledAt: null });
    expect(list.some((r) => r.email === 'bot@spam.test')).toBe(false);

    const handled = (
      await as(admin, 'post', `/admin/contact-requests/${list[0]!.id}/handled`)
        .send({ handled: true })
        .expect(200)
    ).body as ContactRequestDto;
    expect(handled.handledAt).not.toBeNull();
    const after = (await as(admin, 'get', '/admin/contact-requests').expect(200))
      .body as ContactRequestDto[];
    expect(after.at(-1)?.id).toBe(list[0]!.id);

    const handle = createDb(databaseUrl!, { max: 1 });
    const rows = await handle.db.select().from(contactRequests);
    await handle.close();
    expect(rows).toHaveLength(3);
  });
});
