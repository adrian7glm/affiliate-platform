import { createPublicKey, verify } from 'node:crypto';
import type {
  CheckInResultDto,
  CheckoutResultDto,
  ProductDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { createDb, memberships, tenants, users } from '@ap/db';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/** Reads the QR code in a PNG image, as a phone camera at the boarding ramp would. */
function readQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

/**
 * Tickets and their QR codes: the code in the email is the ticket, it only opens the gate once,
 * only at the operator who sold it, and nothing about it can be forged or edited.
 */
describe.skipIf(!databaseUrl)('tickets and QR codes (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let otherOwner: string;
  let otherTenantId: string;
  let product: ProductDto;
  let slot: SlotDto;

  const as = (token: string, tenantId: string, method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', tenantId);
  const scan = async (token: string, by = owner, tenantId = h.tenantId) =>
    (await as(by, tenantId, 'post', '/operator/tickets/check-in').send({ token }).expect(200))
      .body as CheckInResultDto;
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
  const ticketOf = async (result: CheckoutResultDto) =>
    (await h.http.get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`).expect(200))
      .body as TicketDto;

  async function bookAndPay(adults: number, email: string): Promise<CheckoutResultDto> {
    const result = (
      await h.http
        .post('/public/tenants/delta-boats/checkout')
        .send({
          slotId: slot.id,
          items: [{ priceId: product.prices[0]!.id, quantity: adults }],
          acceptTerms: true,
          customer: { name: 'Maria Pop', email, locale: 'ro' },
        })
        .expect(201)
    ).body as CheckoutResultDto;
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
    return result;
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-06T06:00:00Z');
    owner = await signIn(h, h.ownerEmail);

    // A second operator on the platform, with its own boarding staff.
    const seed = createDb(databaseUrl!, { max: 1 });
    const [other] = await seed.db
      .insert(tenants)
      .values({ slug: 'other-boats', name: 'Other Boats' })
      .returning();
    const [otherUser] = await seed.db
      .insert(users)
      .values({ email: 'owner@other.test', name: 'Other owner' })
      .returning();
    await seed.db
      .insert(memberships)
      .values({ userId: otherUser!.id, tenantId: other!.id, role: 'owner' });
    await seed.close();
    otherTenantId = other!.id;
    otherOwner = await signIn(h, 'owner@other.test');

    product = (
      await as(owner, h.tenantId, 'post', '/operator/products')
        .send({
          name: 'Plimbare în Deltă',
          slug: 'delta',
          durationMinutes: 90,
          meetingPoint: 'Debarcaderul 3',
          prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
        })
        .expect(201)
    ).body as ProductDto;
    await as(owner, h.tenantId, 'post', `/operator/products/${product.id}/slots`)
      .send({ fromDate: '2026-10-06', toDate: '2026-10-06', times: ['10:00'], capacity: 30 })
      .expect(201);
    slot = (
      (
        await h.http
          .get('/public/tenants/delta-boats/products/delta/slots?from=2026-10-06&to=2026-10-06')
          .expect(200)
      ).body as SlotDto[]
    )[0]!;
  });

  afterAll(async () => {
    await h?.close();
  });

  it('puts in the email a QR code that is exactly the ticket, and it boards', async () => {
    const result = await bookAndPay(2, 'qr@example.com');
    const ticket = await ticketOf(result);
    const email = await h.lastMessage('qr@example.com');
    const image = email?.attachments?.find((a) => a.contentType === 'image/png');
    expect(image).toBeDefined();

    const scanned = readQr(Buffer.from(image!.content as Buffer));
    expect(scanned).toBe(ticket.qrToken);
    const boarding = await scan(scanned!);
    expect(boarding).toMatchObject({ result: 'checked_in', collectMinor: 0 });
    expect(boarding.ticket).toMatchObject({
      bookingReference: result.booking.reference,
      customerName: 'Maria Pop',
      seats: 2,
      status: 'checked_in',
    });
  });

  it('can be checked offline with the published key, and says which ticket it is', async () => {
    const result = await bookAndPay(3, 'offline@example.com');
    const { qrToken } = await ticketOf(result);
    const { publicKeyPem } = (await h.http.get('/public/ticket-key').expect(200)).body as {
      publicKeyPem: string;
    };
    const [, body, signature] = qrToken!.split('.');
    expect(
      verify(
        null,
        Buffer.from(body!),
        createPublicKey(publicKeyPem),
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(body!, 'base64url').toString())).toMatchObject({
      ten: h.tenantId,
      ref: result.booking.reference,
      at: slot.startsAt,
      seats: 3,
    });
  });

  it('lets a ticket through exactly once, even when two phones scan it at the same moment', async () => {
    const result = await bookAndPay(1, 'race@example.com');
    const { qrToken } = await ticketOf(result);
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => scan(qrToken!)));
    const results = outcomes.map((o) => o.result).sort();
    expect(results).toEqual([
      'already_checked_in',
      'already_checked_in',
      'already_checked_in',
      'already_checked_in',
      'already_checked_in',
      'checked_in',
    ]);
    expect(new Set(outcomes.map((o) => o.checkedInAt)).size).toBe(1);
    expect((await ticketOf(result)).status).toBe('checked_in');
  });

  it("refuses another operator's tickets without using them up", async () => {
    const result = await bookAndPay(1, 'elsewhere@example.com');
    const { qrToken } = await ticketOf(result);
    const elsewhere = await scan(qrToken!, otherOwner, otherTenantId);
    expect(elsewhere).toMatchObject({ result: 'not_valid', ticket: null });
    expect(elsewhere.message).toContain('not a ticket of this operator');
    // Still good at the right boat.
    expect((await scan(qrToken!)).result).toBe('checked_in');
  });

  it('refuses a QR code whose content was edited, and anything that is not a ticket', async () => {
    const result = await bookAndPay(1, 'edit@example.com');
    const { qrToken } = await ticketOf(result);
    const [version, body, signature] = qrToken!.split('.');
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString()) as { seats: number };
    const edited = Buffer.from(JSON.stringify({ ...payload, seats: 9 })).toString('base64url');

    for (const token of [
      `${version}.${edited}.${signature}`,
      `${version}.${body}.${signature!.slice(0, -2)}`,
      `${version}.${body}`,
      'https://example.com/not-a-ticket',
    ]) {
      expect((await scan(token)).result).toBe('not_valid');
    }
    for (const token of ['', result.booking.reference]) {
      await as(owner, h.tenantId, 'post', '/operator/tickets/check-in').send({ token }).expect(400);
    }
    // None of that used the real ticket.
    expect((await scan(qrToken!)).result).toBe('checked_in');
  });

  it('stops a cancelled ticket at boarding, and it has no PDF or calendar entry', async () => {
    const result = await bookAndPay(2, 'cancelled@example.com');
    const { qrToken } = await ticketOf(result);
    await as(owner, h.tenantId, 'post', `/operator/bookings/${result.booking.id}/cancel`)
      .send({ reason: 'customer asked' })
      .expect(200);

    expect(await ticketOf(result)).toMatchObject({ status: 'void', qrToken: null });
    const boarding = await scan(qrToken!);
    expect(boarding.result).toBe('not_valid');
    expect(boarding.ticket?.status).toBe('void');
    const k = keyOf(result);
    await h.http.get(`/public/tickets/${result.booking.id}/pdf?k=${k}`).expect(409);
    await h.http.get(`/public/tickets/${result.booking.id}/calendar.ics?k=${k}`).expect(409);
  });

  it('only opens a ticket page with its own key', async () => {
    const first = await bookAndPay(1, 'key-a@example.com');
    const second = await bookAndPay(1, 'key-b@example.com');
    const id = first.booking.id;
    await h.http.get(`/public/tickets/${id}`).expect(404);
    await h.http.get(`/public/tickets/${id}?k=wrong`).expect(404);
    await h.http.get(`/public/tickets/${id}?k=${keyOf(second)}`).expect(404);
    await h.http.get(`/public/tickets/${id}/pdf?k=${keyOf(second)}`).expect(404);
    await h.http.get(`/public/tickets/${id}/calendar.ics?k=${keyOf(second)}`).expect(404);
    await h.http
      .post(`/public/dev-payments/${second.booking.id}/succeed?k=${keyOf(first)}`)
      .expect(403);

    const pdf = await h.http
      .get(`/public/tickets/${id}/pdf?k=${keyOf(first)}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it("does not show another operator's bookings to scanners or staff", async () => {
    const result = await bookAndPay(1, 'private@example.com');
    await as(otherOwner, otherTenantId, 'post', `/operator/bookings/${result.booking.id}/cancel`)
      .send({ reason: 'not mine' })
      .expect(404);
    const { qrToken } = await ticketOf(result);
    await as(otherOwner, h.tenantId, 'post', '/operator/tickets/check-in')
      .send({ token: qrToken })
      .expect(403);
    expect((await ticketOf(result)).status).toBe('valid');
  });
});
