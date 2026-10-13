import type {
  CheckInResultDto,
  CheckoutResultDto,
  MeDto,
  ProductDto,
  ScannerAccountDto,
  ScannerContextDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * Boarding staff: the operator gives someone a scanner account, that person can scan tickets and
 * nothing else, a second scan says when and by whom the ticket was used, and every ticket also
 * comes as a PDF (download and email attachment).
 */
describe.skipIf(!databaseUrl)('boarding scanners and PDF tickets (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let scanner: string;
  let product: ProductDto;
  let slot: SlotDto;
  let booking: CheckoutResultDto;
  let ticket: TicketDto;
  let scannerUserId: string;
  const scannerPhone = '+40722000099';
  const customerEmail = 'pdf-tourist@example.com';

  const as = (token: string, method: 'get' | 'post' | 'delete', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;

  async function book(adults: number, email = customerEmail): Promise<CheckoutResultDto> {
    const response = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: product.prices[0]!.id, quantity: adults }],
        acceptTerms: true,
        customer: { name: 'Ștefan Țurcanu', email, locale: 'ro' },
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
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    product = (
      await as(owner, 'post', '/operator/products')
        .send({
          name: 'Plimbare în Deltă',
          slug: 'delta',
          durationMinutes: 90,
          meetingPoint: 'Debarcaderul 3, Tulcea',
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await as(owner, 'post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-10-06', times: ['10:00'], capacity: 20 })
      .expect(201);
    const slots = (
      await h.http
        .get('/public/tenants/delta-boats/products/delta/slots?from=2026-10-06&to=2026-10-06')
        .expect(200)
    ).body as SlotDto[];
    slot = slots[0]!;
    booking = await book(2);
    await pay(booking);
    ticket = (
      await h.http.get(`/public/tickets/${booking.booking.id}?k=${keyOf(booking)}`).expect(200)
    ).body as TicketDto;
    expect(ticket.status).toBe('valid');
  });

  afterAll(async () => {
    await h?.close();
  });

  it('lets the operator create a scanner account, which is told how to sign in', async () => {
    const created = (
      await as(owner, 'post', '/operator/scanners')
        .send({ name: 'Mihai la ponton', destination: scannerPhone })
        .expect(201)
    ).body as ScannerAccountDto;
    expect(created).toMatchObject({
      name: 'Mihai la ponton',
      phone: scannerPhone,
      lastScanAt: null,
    });
    scannerUserId = created.userId;

    const invite = await h.lastMessage(scannerPhone);
    expect(invite?.text).toContain('scanarea biletelor');
    expect(invite?.text).toContain('http://web.test/login?next=%2Fs');

    await as(owner, 'post', '/operator/scanners')
      .send({ name: 'Mihai', destination: scannerPhone })
      .expect(409);
    const list = (await as(owner, 'get', '/operator/scanners').expect(200))
      .body as ScannerAccountDto[];
    expect(list.map((s) => s.userId)).toEqual([scannerUserId]);
  });

  it('gives the scanner access to scanning only', async () => {
    scanner = await signIn(h, scannerPhone);
    const me = (await h.http.get('/me').set('authorization', `Bearer ${scanner}`).expect(200))
      .body as MeDto;
    expect(me.memberships.map((m) => m.role)).toEqual(['scanner']);

    await as(scanner, 'get', '/operator/bookings?from=2026-10-01&to=2026-10-31').expect(403);
    await as(scanner, 'get', '/operator/affiliates').expect(403);
    await as(scanner, 'get', '/operator/scanners').expect(403);
    await as(scanner, 'get', '/affiliate/home').expect(403);

    const context = (await as(scanner, 'get', '/scanner/context').expect(200))
      .body as ScannerContextDto;
    expect(context).toMatchObject({
      tenant: { name: 'Delta Boats', timezone: 'Europe/Bucharest' },
      scannedTodayByMe: 0,
    });
  });

  it('checks a ticket in on the first scan and shows when and by whom on the next', async () => {
    h.clock.set('2026-10-06T06:50:00Z');
    const first = (
      await as(scanner, 'post', '/operator/tickets/check-in')
        .send({ token: ticket.qrToken })
        .expect(200)
    ).body as CheckInResultDto;
    expect(first).toMatchObject({
      result: 'checked_in',
      checkedInAt: '2026-10-06T06:50:00.000Z',
      checkedInBy: 'Mihai la ponton',
    });

    h.clock.set('2026-10-06T06:55:00Z');
    const again = (
      await as(owner, 'post', '/operator/tickets/check-in')
        .send({ token: ticket.qrToken })
        .expect(200)
    ).body as CheckInResultDto;
    expect(again).toMatchObject({
      result: 'already_checked_in',
      checkedInAt: '2026-10-06T06:50:00.000Z',
      checkedInBy: 'Mihai la ponton',
    });

    const used = (
      await h.http.get(`/public/tickets/${booking.booking.id}?k=${keyOf(booking)}`).expect(200)
    ).body as TicketDto;
    expect(used.status).toBe('checked_in');

    const context = (await as(scanner, 'get', '/scanner/context').expect(200))
      .body as ScannerContextDto;
    expect(context.scannedTodayByMe).toBe(1);
    const [account] = (await as(owner, 'get', '/operator/scanners').expect(200))
      .body as ScannerAccountDto[];
    expect(account?.lastScanAt).toBe('2026-10-06T06:50:00.000Z');
  });

  it('serves the ticket as a PDF with the ticket link key only', async () => {
    const response = await h.http
      .get(`/public/tickets/${booking.booking.id}/pdf?k=${keyOf(booking)}&download=1`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="bilet-${booking.booking.reference}.pdf"`,
    );
    const pdf = response.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('DejaVuSans');

    await h.http.get(`/public/tickets/${booking.booking.id}/pdf?k=wrong`).expect(404);

    const unpaid = await book(1, 'unpaid@example.com');
    await h.http.get(`/public/tickets/${unpaid.booking.id}/pdf?k=${keyOf(unpaid)}`).expect(409);
  });

  it('attaches the PDF ticket to the ticket email', async () => {
    const email = await h.lastMessage(customerEmail);
    expect(email?.subject).toContain('Biletul tău');
    const attachments = email?.attachments ?? [];
    const pdf = attachments.find((a) => a.contentType === 'application/pdf');
    expect(pdf?.filename).toBe(`bilet-${booking.booking.reference}.pdf`);
    expect(pdf?.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(attachments.some((a) => a.contentType === 'image/png')).toBe(true);
  });

  it('takes scanning away when the operator removes the account', async () => {
    await as(owner, 'delete', `/operator/scanners/${scannerUserId}`).expect(204);
    await as(owner, 'delete', `/operator/scanners/${scannerUserId}`).expect(404);
    await as(scanner, 'post', '/operator/tickets/check-in')
      .send({ token: ticket.qrToken })
      .expect(403);
    expect((await as(owner, 'get', '/operator/scanners').expect(200)).body).toEqual([]);
  });
});
