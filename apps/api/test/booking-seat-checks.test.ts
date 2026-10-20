import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InMemoryProvider, createReferenceServer } from '@ap/adapters';
import type {
  CheckoutResultDto,
  DomainEvent,
  ProductDto,
  SlotDto,
  SourceDto,
  TicketDto,
} from '@ap/contracts';
import { bookings, createDb, outboxEvents } from '@ap/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BookingService } from '../src/booking/booking.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * Seats checked at the last moment: a payment that arrives after the operator's own system sold
 * the seats or after the boat left, a departure called off while the customer is at checkout,
 * and two operator systems that happen to use the same ids for different trips.
 */
describe.skipIf(!databaseUrl)('seats checked at the last moment (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  const servers: Server[] = [];
  const departure = new Date('2026-10-06T15:00:00Z');
  const backend = new InMemoryProvider(
    [
      {
        externalId: 'dolphins',
        name: 'Dolphins',
        durationMinutes: 120,
        prices: [{ code: 'adult', label: 'Adult', amountMinor: 12_000, taxRateBps: 900 }],
      },
    ],
    () => h.clock.now(),
  );
  const departureId = backend.addSlot('dolphins', departure, 120, 4);
  backend.addSlot('dolphins', new Date('2026-10-07T15:00:00Z'), 120, 4);

  const asOwner = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
  const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;

  async function connect(name: string, provider: InMemoryProvider): Promise<void> {
    const server = createReferenceServer(provider, 'tok');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await asOwner('post', '/operator/sources').send({ name, baseUrl, token: 'tok' }).expect(201);
  }

  async function products(): Promise<ProductDto[]> {
    return (await asOwner('get', '/operator/products').expect(200)).body as ProductDto[];
  }

  async function slotOn(product: ProductDto, date: string): Promise<SlotDto> {
    const listed = await h.http
      .get(`/public/tenants/delta-boats/products/${product.slug}/slots?from=${date}&to=${date}`)
      .expect(200);
    return (listed.body as SlotDto[])[0]!;
  }

  function book(product: ProductDto, slot: SlotDto, seats: number, email: string) {
    return h.http.post('/public/tenants/delta-boats/checkout').send({
      slotId: slot.id,
      items: [{ priceId: product.prices[0]!.id, quantity: seats }],
      acceptTerms: true,
      customer: { name: 'Tourist', email, locale: 'en' },
    });
  }

  async function pay(result: CheckoutResultDto): Promise<void> {
    await h.http
      .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
      .expect(204);
    await h.outbox.drain();
  }

  async function ticket(result: CheckoutResultDto): Promise<TicketDto> {
    const response = await h.http
      .get(`/public/tickets/${result.booking.id}?k=${keyOf(result)}`)
      .expect(200);
    return response.body as TicketDto;
  }

  async function stored(bookingId: string) {
    const handle = createDb(databaseUrl!, { max: 1 });
    const [booking] = await handle.db.select().from(bookings).where(eq(bookings.id, bookingId));
    const events = await handle.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(eq(outboxEvents.type, 'booking.cancelled'));
    await handle.close();
    const cancelled = events
      .map((e) => e.payload as DomainEvent)
      .filter((e) => e.type === 'booking.cancelled' && e.bookingId === bookingId);
    return { booking: booking!, cancelled };
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    await connect('Dolphin desk', backend);
  });

  afterAll(async () => {
    for (const server of servers)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await h?.close();
  });

  it("refunds a late payment whose seats the operator's system sold meanwhile", async () => {
    h.clock.set('2026-10-05T08:00:00Z');
    const [product] = await products();
    const slot = await slotOn(product!, '2026-10-06');
    const late = (await book(product!, slot, 2, 'late@example.com').expect(201))
      .body as CheckoutResultDto;
    h.clock.set('2026-10-05T08:31:00Z');
    expect(await h.app.get(BookingService).expireUnpaid()).toBe(1);
    // The operator sells every seat at their own desk.
    const desk = await backend.hold({
      productExternalId: 'dolphins',
      slotExternalId: departureId,
      startsAt: departure,
      seats: 4,
      ttlSeconds: 600,
    });
    await backend.confirm({
      holdId: desk.holdId,
      reference: 'DESK',
      customerName: 'Walk-in',
      customerEmail: null,
      customerPhone: null,
      seats: 4,
    });
    const refundsBefore = h.payments.refunds.length;

    await pay(late);

    expect((await ticket(late)).status).toBe('void');
    expect(h.payments.refunds.slice(refundsBefore)).toEqual([
      expect.objectContaining({ amountMinor: 24_000 }),
    ]);
    const { booking, cancelled } = await stored(late.booking.id);
    expect(booking.status).toBe('refunded');
    expect(booking.externalRef).toBeNull();
    // The usual cancellation: the affiliate's commission is reversed and the customer is told.
    expect(cancelled).toEqual([expect.objectContaining({ refunded: true })]);
    expect((await h.lastMessage('late@example.com'))?.text).toBeTruthy();
    // The seats this booking counted in the local cache are given back.
    const passengers = await asOwner('get', `/operator/departures/${slot.id}/passengers`).expect(
      200,
    );
    expect(JSON.stringify(passengers.body)).not.toContain('late@example.com');
  });

  it('refunds a late payment for an imported departure that has already left', async () => {
    h.clock.set('2026-10-06T10:00:00Z');
    const [product] = await products();
    const slot = await slotOn(product!, '2026-10-07');
    const late = (await book(product!, slot, 1, 'gone@example.com').expect(201))
      .body as CheckoutResultDto;
    h.clock.set('2026-10-07T16:00:00Z');
    await h.app.get(BookingService).expireUnpaid();
    const refundsBefore = h.payments.refunds.length;

    await pay(late);

    expect((await ticket(late)).status).toBe('void');
    expect(h.payments.refunds.length).toBe(refundsBefore + 1);
    expect((await stored(late.booking.id)).booking.status).toBe('refunded');
  });

  it('refuses a booking on a departure called off while the customer was at checkout', async () => {
    h.clock.set('2026-10-05T12:00:00Z');
    const created = await asOwner('post', '/operator/products')
      .send({
        name: 'Kayak tour',
        slug: 'kayak',
        durationMinutes: 60,
        prices: [{ code: 'adult', label: 'Adult', amountMinor: 10_000, taxRateBps: 900 }],
      })
      .expect(201);
    const kayak = created.body as ProductDto;
    await asOwner('post', `/operator/products/${kayak.id}/slots`)
      .send({ fromDate: '2026-10-11', toDate: '2026-10-11', times: ['10:00'], capacity: 4 })
      .expect(201);
    const slot = await slotOn(kayak, '2026-10-11');
    const service = h.app.get(BookingService);
    const db = (service as unknown as { db: { transaction: (...args: unknown[]) => unknown } }).db;
    const original = db.transaction.bind(db);
    // The operator calls the departure off after checkout read it as open, before seats are taken.
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(async (...args: unknown[]) => {
      await asOwner('post', `/operator/products/${kayak.id}/slots/cancel`)
        .send({ slotIds: [slot.id], reason: 'weather' })
        .expect(200);
      return original(...args);
    });
    try {
      const refused = await book(kayak, slot, 1, 'escape@example.com').expect(409);
      expect(refused.body.code).toBe('errors.departures.closed');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps apart the trips of two operator systems that use the same ids', async () => {
    const other = new InMemoryProvider(
      [
        {
          externalId: 'dolphins',
          name: 'Sunset cruise',
          durationMinutes: 90,
          prices: [{ code: 'vip', label: 'VIP', amountMinor: 99_900, taxRateBps: 0 }],
        },
      ],
      () => h.clock.now(),
    );
    other.addSlot('dolphins', new Date('2026-10-06T18:00:00Z'), 90, 40);

    await connect('Cruise desk', other);

    const names = (await products()).map((p) => p.name).sort();
    expect(names).toEqual(['Dolphins', 'Kayak tour', 'Sunset cruise']);
    const sources = (await asOwner('get', '/operator/sources').expect(200)).body as SourceDto[];
    expect(sources.map((s) => [s.name, s.productCount])).toEqual([
      ['Dolphin desk', 1],
      ['Cruise desk', 1],
    ]);
    // Syncing the first system again does not take the second system's trip back.
    await asOwner('post', `/operator/sources/${sources[0]!.id}/sync`).expect(200);
    const dolphins = (await products()).find((p) => p.name === 'Dolphins')!;
    expect(dolphins.prices.map((p) => p.code)).toEqual(['adult']);
  });
});
