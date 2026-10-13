import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { InMemoryProvider, createReferenceServer } from '@ap/adapters';
import type { BookingDto, CheckoutResultDto, ProductDto, SlotDto, SourceDto } from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingService } from '../src/booking/booking.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * An operator with their own booking system, reached over HTTP through the REST adapter: trips
 * and departures are imported from it, and seats are held, confirmed, released and cancelled in
 * it. The operator's system is the reference implementation of docs/rest-adapter.md.
 */
describe.skipIf(!databaseUrl)(
  'operator system connected over REST (needs TEST_DATABASE_URL)',
  () => {
    let h: Harness;
    let owner: string;
    let server: Server;
    let baseUrl: string;
    let product: ProductDto;
    let paid: CheckoutResultDto;
    const firstDeparture = new Date('2026-10-06T15:00:00Z');
    const secondDeparture = new Date('2026-10-07T15:00:00Z');
    const backend = new InMemoryProvider(
      [
        {
          externalId: 'dolphins',
          name: 'Delfini și apus',
          durationMinutes: 120,
          prices: [
            { code: 'adult', label: 'Adult', amountMinor: 12_000, taxRateBps: 900 },
            { code: 'child', label: 'Copil', amountMinor: 6_000, taxRateBps: 900 },
          ],
        },
      ],
      () => h.clock.now(),
    );
    const firstId = backend.addSlot('dolphins', firstDeparture, 120, 6);
    const secondId = backend.addSlot('dolphins', secondDeparture, 120, 6);

    const asOwner = (method: 'get' | 'post', path: string) =>
      h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);
    const keyOf = (result: CheckoutResultDto) => new URL(result.ticketUrl).searchParams.get('k')!;
    const adult = () => product.prices.find((p) => p.code === 'adult')!;
    const later = (minutes: number) =>
      h.clock.set(new Date(h.clock.now().getTime() + minutes * 60_000).toISOString());

    /** Seats left in the operator's own system. */
    async function remoteAvailable(slotId: string, startsAt: Date): Promise<number> {
      const slots = await backend.getAvailability(
        'dolphins',
        startsAt,
        new Date(startsAt.getTime() + 1),
      );
      return slots.find((s) => s.externalId === slotId)!.available;
    }

    async function publicSlots(date: string): Promise<SlotDto[]> {
      const response = await h.http
        .get(`/public/tenants/delta-boats/products/${product.slug}/slots?from=${date}&to=${date}`)
        .expect(200);
      return response.body as SlotDto[];
    }

    function checkout(slot: SlotDto, adults: number) {
      return h.http.post('/public/tenants/delta-boats/checkout').send({
        slotId: slot.id,
        items: [{ priceId: adult().id, quantity: adults }],
        acceptTerms: true,
        customer: { name: 'Tourist', email: 'tourist@example.com', locale: 'en' },
      });
    }

    async function pay(result: CheckoutResultDto): Promise<BookingDto> {
      await h.http
        .post(`/public/dev-payments/${result.booking.id}/succeed?k=${keyOf(result)}`)
        .expect(204);
      await h.outbox.drain();
      const list = await asOwner('get', '/operator/bookings?from=2026-10-01&to=2026-10-31').expect(
        200,
      );
      return (list.body as BookingDto[]).find((b) => b.id === result.booking.id)!;
    }

    beforeAll(async () => {
      h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
      owner = await signIn(h, h.ownerEmail);
      server = createReferenceServer(backend, 'operator-token');
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await h?.close();
    });

    it('refuses a system that does not accept the token', async () => {
      await asOwner('post', '/operator/sources')
        .send({ name: 'Sistemul Delta', baseUrl, token: 'wrong' })
        .expect(400);
    });

    it('imports trips, prices and departures from the operator system', async () => {
      const response = await asOwner('post', '/operator/sources')
        .send({ name: 'Sistemul Delta', baseUrl, token: 'operator-token' })
        .expect(201);
      const source = response.body as SourceDto;
      expect(source).toMatchObject({ kind: 'rest', baseUrl, productCount: 1 });
      expect(source.lastSyncedAt).not.toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('operator-token');

      const products = (await asOwner('get', '/operator/products').expect(200))
        .body as ProductDto[];
      product = products.find((p) => p.name === 'Delfini și apus')!;
      expect(product).toMatchObject({ slug: 'delfini-si-apus', managedExternally: true });
      expect(product.prices.map((p) => p.code).sort()).toEqual(['adult', 'child']);

      const [slot] = await publicSlots('2026-10-06');
      expect(slot).toMatchObject({ startsAt: firstDeparture.toISOString(), available: 6 });

      await asOwner('post', `/operator/products/${product.id}/slots`)
        .send({ fromDate: '2026-10-08', toDate: '2026-10-08', times: ['10:00'], capacity: 10 })
        .expect(409);
    });

    it('shows seats the operator sold elsewhere', async () => {
      const desk = await backend.hold({
        productExternalId: 'dolphins',
        slotExternalId: firstId,
        startsAt: firstDeparture,
        seats: 2,
        ttlSeconds: 600,
      });
      await backend.confirm({
        holdId: desk.holdId,
        reference: 'DESK-1',
        customerName: 'Walk-in',
        customerEmail: null,
        customerPhone: null,
        seats: 2,
      });
      later(2);
      const [slot] = await publicSlots('2026-10-06');
      expect(slot!.available).toBe(4);
    });

    it('holds seats in the operator system and books them there once paid', async () => {
      const [slot] = await publicSlots('2026-10-06');
      paid = (await checkout(slot!, 3).expect(201)).body as CheckoutResultDto;
      expect(await remoteAvailable(firstId, firstDeparture)).toBe(1);

      const booking = await pay(paid);
      expect(booking.status).toBe('confirmed');
      expect(booking.externalRef).toBe(`MEM-${paid.booking.reference}`);

      later(45); // well past the hold: confirmed seats stay taken in the operator system
      expect(await remoteAvailable(firstId, firstDeparture)).toBe(1);
    });

    it('never oversells: the operator system has the last word on seats', async () => {
      const [slot] = await publicSlots('2026-10-06');
      const response = await checkout(slot!, 2).expect(409);
      expect(response.body.message).toContain('only 1 seat left');
    });

    it('releases the hold in the operator system when an unpaid booking is cancelled', async () => {
      const [slot] = await publicSlots('2026-10-07');
      const pending = (await checkout(slot!, 2).expect(201)).body as CheckoutResultDto;
      expect(await remoteAvailable(secondId, secondDeparture)).toBe(4);
      await asOwner('post', `/operator/bookings/${pending.booking.id}/cancel`)
        .send({ reason: 'customer changed plans' })
        .expect(200);
      expect(await remoteAvailable(secondId, secondDeparture)).toBe(6);
    });

    it('books again in the operator system when the payment arrives after the hold expired', async () => {
      const [slot] = await publicSlots('2026-10-07');
      const pending = (await checkout(slot!, 2).expect(201)).body as CheckoutResultDto;
      later(31);
      expect(await h.app.get(BookingService).expireUnpaid()).toBe(1);
      expect(await remoteAvailable(secondId, secondDeparture)).toBe(6);

      const booking = await pay(pending);
      expect(booking.status).toBe('confirmed');
      expect(booking.externalRef).toBe(`MEM-${pending.booking.reference}`);
      expect(await remoteAvailable(secondId, secondDeparture)).toBe(4);
    });

    it('cancels in the operator system when a paid booking is refunded', async () => {
      const response = await asOwner('post', `/operator/bookings/${paid.booking.id}/cancel`)
        .send({ reason: 'weather' })
        .expect(200);
      expect((response.body as BookingDto).status).toBe('refunded');
      expect(await remoteAvailable(firstId, firstDeparture)).toBe(4);
    });

    it('keeps showing the last known departures when the operator system is down', async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      later(2);
      const [slot] = await publicSlots('2026-10-06');
      expect(slot!.available).toBe(4);
      const response = await checkout(slot!, 1).expect(502);
      expect(response.body.message).toContain('Sistemul Delta');
    });
  },
);
