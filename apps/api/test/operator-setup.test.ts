import type {
  AffiliateDto,
  CheckoutResultDto,
  CommissionPlanDto,
  OperatorSettingsDto,
  OperatorSlotDto,
  ProductDto,
  PublicTenantDto,
  SlotDto,
  TicketDto,
} from '@ap/contracts';
import { createDb, memberships, users } from '@ap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * The operator manages everything from the app: trips, prices and departures, commission plans,
 * and the look of the customer pages.
 */
describe.skipIf(!databaseUrl)('operator setup (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let product: ProductDto;

  const asOwner = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);

  async function operatorSlots(from: string, to: string): Promise<OperatorSlotDto[]> {
    const r = await asOwner('get', `/operator/products/${product.id}/slots?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    return r.body as OperatorSlotDto[];
  }

  async function publicSlots(slug: string, day: string): Promise<SlotDto[]> {
    const r = await h.http
      .get(`/public/tenants/delta-boats/products/${slug}/slots?from=${day}&to=${day}`)
      .expect(200);
    return r.body as SlotDto[];
  }

  async function book(slot: SlotDto, adults: number): Promise<CheckoutResultDto> {
    const adult = product.prices.find((p) => p.code === 'adult')!;
    const r = await h.http
      .post('/public/tenants/delta-boats/checkout')
      .send({
        slotId: slot.id,
        items: [{ priceId: adult.id, quantity: adults }],
        acceptTerms: true,
        customer: { name: 'Tourist', email: 'tourist@example.com', locale: 'en' },
      })
      .expect(201);
    return r.body as CheckoutResultDto;
  }

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    owner = await signIn(h, h.ownerEmail);
    const created = await asOwner('post', '/operator/products')
      .send({
        name: 'Sunset cruise',
        slug: 'sunset-cruise',
        durationMinutes: 90,
        prices: [
          { code: 'adult', label: 'Adult', amountMinor: 10_000 },
          { code: 'child', label: 'Child', amountMinor: 5_000 },
        ],
      })
      .expect(201);
    product = created.body as ProductDto;
    await asOwner('post', `/operator/products/${product.id}/slots`)
      .send({
        fromDate: '2026-10-06',
        toDate: '2026-10-07',
        times: ['10:00', '18:00'],
        capacity: 10,
      })
      .expect(201);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('edits a trip: details, prices added, changed and retired', async () => {
    const adult = product.prices.find((p) => p.code === 'adult')!;
    const r = await asOwner('patch', `/operator/products/${product.id}`)
      .send({
        name: 'Sunset cruise & dinner',
        slug: 'sunset-dinner',
        durationMinutes: 120,
        meetingPoint: 'Pier 4',
        prices: [
          { id: adult.id, label: 'Adult', amountMinor: 12_000, taxRateBps: 900, seats: 1 },
          { label: 'Familie (2+2)', amountMinor: 30_000, seats: 4 },
        ],
      })
      .expect(200);
    product = r.body as ProductDto;
    expect(product.name).toBe('Sunset cruise & dinner');
    expect(product.slug).toBe('sunset-dinner');
    expect(product.prices.map((p) => [p.code, p.amountMinor])).toEqual([
      ['familie_2_2', 30_000],
      ['adult', 12_000],
    ]);
    expect(product.prices.find((p) => p.code === 'adult')!.id).toBe(adult.id);

    // Departures already scheduled follow the new duration.
    const [first] = await operatorSlots('2026-10-06', '2026-10-06');
    expect(new Date(first!.endsAt).getTime() - new Date(first!.startsAt).getTime()).toBe(
      120 * 60_000,
    );

    // The customer page uses the new address and prices.
    await h.http.get('/public/tenants/delta-boats/products/sunset-cruise').expect(404);
    const pub = await h.http.get('/public/tenants/delta-boats/products/sunset-dinner').expect(200);
    expect((pub.body as ProductDto).prices).toHaveLength(2);

    // A ticket type named like a retired one comes back with the same id.
    const child = await asOwner('patch', `/operator/products/${product.id}`)
      .send({
        prices: [
          ...product.prices.map((p) => ({ ...p })),
          { label: 'Child', code: 'child', amountMinor: 6_000 },
        ],
      })
      .expect(200);
    product = child.body as ProductDto;
    expect(product.prices.map((p) => p.code).sort()).toEqual(['adult', 'child', 'familie_2_2']);
  });

  it('refuses an address already used by another trip', async () => {
    await asOwner('post', '/operator/products')
      .send({
        name: 'Delta tour',
        slug: 'delta-tour',
        durationMinutes: 240,
        prices: [{ code: 'adult', label: 'Adult', amountMinor: 20_000 }],
      })
      .expect(201);
    await asOwner('patch', `/operator/products/${product.id}`)
      .send({ slug: 'delta-tour' })
      .expect(409);
  });

  it('pauses sales of a trip without deleting it', async () => {
    await asOwner('patch', `/operator/products/${product.id}`).send({ active: false }).expect(200);
    const tenant = (await h.http.get('/public/tenants/delta-boats').expect(200))
      .body as PublicTenantDto;
    expect(tenant.products.map((p) => p.slug)).toEqual(['delta-tour']);
    await h.http.get('/public/tenants/delta-boats/products/sunset-dinner').expect(404);
    const listed = (await asOwner('get', '/operator/products').expect(200)).body as ProductDto[];
    expect(listed.find((p) => p.id === product.id)?.active).toBe(false);

    await asOwner('patch', `/operator/products/${product.id}`).send({ active: true }).expect(200);
    await h.http.get('/public/tenants/delta-boats/products/sunset-dinner').expect(200);
  });

  it('closes a day of departures and reopens it', async () => {
    const day = await operatorSlots('2026-10-06', '2026-10-06');
    expect(day).toHaveLength(2);
    const closed = await asOwner('patch', `/operator/products/${product.id}/slots`)
      .send({ slotIds: day.map((s) => s.id), closed: true })
      .expect(200);
    expect((closed.body.slots as OperatorSlotDto[]).every((s) => s.closed)).toBe(true);
    expect(await publicSlots('sunset-dinner', '2026-10-06')).toEqual([]);
    // The operator still sees closed departures.
    expect((await operatorSlots('2026-10-06', '2026-10-06')).map((s) => s.closed)).toEqual([
      true,
      true,
    ]);

    await asOwner('patch', `/operator/products/${product.id}/slots`)
      .send({ slotIds: day.map((s) => s.id), closed: false })
      .expect(200);
    expect(await publicSlots('sunset-dinner', '2026-10-06')).toHaveLength(2);
  });

  it('never lowers capacity below the seats already taken', async () => {
    const [slot] = await publicSlots('sunset-dinner', '2026-10-07');
    await book(slot!, 3);
    const r = await asOwner('patch', `/operator/products/${product.id}/slots`)
      .send({ slotIds: [slot!.id], capacity: 2 })
      .expect(200);
    expect(r.body.capacityRaised).toBe(1);
    expect((r.body.slots as OperatorSlotDto[])[0]).toMatchObject({
      capacity: 3,
      reserved: 3,
      available: 0,
    });
  });

  it('deletes empty departures and only closes booked ones', async () => {
    const day = await operatorSlots('2026-10-07', '2026-10-07');
    expect(day.map((s) => s.reserved)).toEqual([3, 0]);
    const r = await asOwner('post', `/operator/products/${product.id}/slots/delete`)
      .send({ slotIds: day.map((s) => s.id) })
      .expect(200);
    expect(r.body).toEqual({ deleted: 1, closedInstead: 1 });
    const after = await operatorSlots('2026-10-07', '2026-10-07');
    expect(after).toHaveLength(1);
    expect(after[0]!.closed).toBe(true);
  });

  it("does not touch another trip's departures", async () => {
    const [slot] = await operatorSlots('2026-10-06', '2026-10-06');
    const products = (await asOwner('get', '/operator/products').expect(200)).body as ProductDto[];
    const other = products.find((p) => p.slug === 'delta-tour')!;
    await asOwner('patch', `/operator/products/${other.id}/slots`)
      .send({ slotIds: [slot!.id], closed: true })
      .expect(404);
  });

  it('edits, replaces and retires commission plans', async () => {
    const standard = (
      await asOwner('post', '/operator/commission-plans')
        .send({ kind: 'fixed', name: 'Standard', rateBps: 1000 })
        .expect(201)
    ).body as CommissionPlanDto;
    expect(standard.isDefault).toBe(true);
    const hotels = (
      await asOwner('post', '/operator/commission-plans')
        .send({ kind: 'tiered', name: 'Hotels', tiers: [{ fromSale: 1, rateBps: 1500 }] })
        .expect(201)
    ).body as CommissionPlanDto;
    const affiliate = (
      await asOwner('post', '/operator/affiliates')
        .send({ displayName: 'Hotel Central', commissionPlanId: hotels.id })
        .expect(201)
    ).body as AffiliateDto;

    // New rules make a new version that takes over the affiliates.
    const edited = (
      await asOwner('put', `/operator/commission-plans/${hotels.id}`)
        .send({
          kind: 'tiered',
          name: 'Hotels 2027',
          tiers: [
            { fromSale: 1, rateBps: 1500 },
            { fromSale: 4, rateBps: 2000 },
          ],
        })
        .expect(200)
    ).body as CommissionPlanDto;
    expect(edited.id).not.toBe(hotels.id);
    expect(edited.affiliateCount).toBe(1);
    const affiliates = (await asOwner('get', '/operator/affiliates').expect(200))
      .body as AffiliateDto[];
    expect(affiliates.find((a) => a.id === affiliate.id)?.commissionPlanId).toBe(edited.id);
    let plans = (await asOwner('get', '/operator/commission-plans').expect(200))
      .body as CommissionPlanDto[];
    expect(plans.map((p) => [p.name, p.isDefault, p.affiliateCount])).toEqual([
      ['Standard', true, 0],
      ['Hotels 2027', false, 1],
    ]);
    // The old version can't be assigned or edited any more.
    await asOwner('patch', `/operator/affiliates/${affiliate.id}`)
      .send({ commissionPlanId: hotels.id })
      .expect(404);
    await asOwner('delete', `/operator/commission-plans/${hotels.id}`).expect(404);

    // The default plan can't be retired until another plan is the default.
    await asOwner('delete', `/operator/commission-plans/${standard.id}`).expect(409);
    await asOwner('post', `/operator/commission-plans/${edited.id}/make-default`)
      .expect(200)
      .expect((r) => expect(r.body.isDefault).toBe(true));
    await asOwner('delete', `/operator/commission-plans/${standard.id}`)
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ affiliatesMoved: 0 }));

    // Retiring a plan moves its affiliates to the default plan.
    const extra = (
      await asOwner('post', '/operator/commission-plans')
        .send({ kind: 'fixed', name: 'VIP', rateBps: 3000 })
        .expect(201)
    ).body as CommissionPlanDto;
    await asOwner('patch', `/operator/affiliates/${affiliate.id}`)
      .send({ commissionPlanId: extra.id })
      .expect(200);
    await asOwner('delete', `/operator/commission-plans/${extra.id}`)
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ affiliatesMoved: 1 }));
    plans = (await asOwner('get', '/operator/commission-plans').expect(200))
      .body as CommissionPlanDto[];
    expect(plans.map((p) => p.name)).toEqual(['Hotels 2027']);
  });

  it('saves the logo, color and booking options and shows them to customers', async () => {
    const before = (await asOwner('get', '/operator/settings').expect(200))
      .body as OperatorSettingsDto;
    expect(before).toMatchObject({ name: 'Delta Boats', allowPayOnSite: true, canEdit: true });

    const logo = `data:image/png;base64,${'A'.repeat(200)}==`;
    const saved = (
      await asOwner('patch', '/operator/settings')
        .send({
          name: 'Delta Boats SRL',
          logoUrl: logo,
          primaryColor: '#0F766E',
          allowPayOnSite: false,
          attributionWindowDays: 14,
        })
        .expect(200)
    ).body as OperatorSettingsDto;
    expect(saved).toMatchObject({
      name: 'Delta Boats SRL',
      branding: { logoUrl: logo, primaryColor: '#0f766e' },
      allowPayOnSite: false,
      attributionWindowDays: 14,
    });

    const tenant = (await h.http.get('/public/tenants/delta-boats').expect(200))
      .body as PublicTenantDto;
    expect(tenant.branding).toEqual({ logoUrl: logo, primaryColor: '#0f766e' });

    const [slot] = await publicSlots('sunset-dinner', '2026-10-06');
    const booking = await book(slot!, 1);
    const url = new URL(booking.ticketUrl);
    const ticket = (
      await h.http
        .get(`/public/tickets/${booking.booking.id}?k=${url.searchParams.get('k')}`)
        .expect(200)
    ).body as TicketDto;
    expect(ticket.branding.primaryColor).toBe('#0f766e');

    // Removing the logo keeps the color.
    await asOwner('patch', '/operator/settings')
      .send({ logoUrl: null })
      .expect(200)
      .expect((r) => expect(r.body.branding).toEqual({ primaryColor: '#0f766e' }));
  });

  it('rejects logos that are not images and colors that are not hex', async () => {
    for (const logoUrl of [
      'javascript:alert(1)',
      'http://insecure.example/logo.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      `data:image/png;base64,${'A'.repeat(91_000)}`,
    ]) {
      await asOwner('patch', '/operator/settings').send({ logoUrl }).expect(400);
    }
    // Bigger than the request limit: refused before validation, still not a server error.
    await asOwner('patch', '/operator/settings')
      .send({ logoUrl: `data:image/png;base64,${'A'.repeat(200_000)}` })
      .expect(413);
    await asOwner('patch', '/operator/settings').send({ primaryColor: 'red' }).expect(400);
  });

  it('lets staff read the settings but not change them', async () => {
    const seed = createDb(databaseUrl!, { max: 1 });
    const [staff] = await seed.db
      .insert(users)
      .values({ email: 'staff@delta.test', name: 'Staff' })
      .returning();
    await seed.db
      .insert(memberships)
      .values({ userId: staff!.id, tenantId: h.tenantId, role: 'staff' });
    await seed.close();
    const token = await signIn(h, 'staff@delta.test');
    const asStaff = (method: 'get' | 'patch', path: string) =>
      h.http[method](path).set('authorization', `Bearer ${token}`).set('x-tenant-id', h.tenantId);
    await asStaff('get', '/operator/settings')
      .expect(200)
      .expect((r) => expect(r.body.canEdit).toBe(false));
    await asStaff('patch', '/operator/settings').send({ name: 'Mine now' }).expect(403);
  });
});
