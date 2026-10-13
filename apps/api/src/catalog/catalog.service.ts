import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateProductBody,
  CreateSlotsBody,
  DeleteSlotsResultDto,
  OperatorSlotDto,
  PriceDto,
  ProductDto,
  SlotDto,
  UpdateProductBody,
  UpdateSlotsBody,
  UpdateSlotsResultDto,
} from '@ap/contracts';
import { type Database, affiliates, bookings, productPrices, products, slots } from '@ap/db';
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { TenantsService } from '../common/tenants';
import { DB, type DbOrTx, type Tx } from '../database/database.module';
import { SourcesService } from '../sources/sources.service';
import {
  cleanTranslations,
  localizedPriceLabel,
  localizedQuestions,
  localizedTexts,
} from './translations';

export type Product = typeof products.$inferSelect;
export type Price = typeof productPrices.$inferSelect;

/**
 * Who a trip is shown to. Operators get their own texts plus the translations; customers and
 * affiliates get the texts in their language, and customers never see the commission rate.
 */
export type ProductView = { kind: 'operator' } | { kind: 'public' | 'affiliate'; lang: string };

const OPERATOR_VIEW: ProductView = { kind: 'operator' };

const MAX_GENERATED_SLOTS = 2000;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tenants: TenantsService,
    private readonly sources: SourcesService,
    private readonly clock: Clock,
  ) {}

  async listProducts(
    tenantId: string,
    onlyActive = true,
    view: ProductView = OPERATOR_VIEW,
  ): Promise<ProductDto[]> {
    const tenant = await this.tenants.get(tenantId);
    const rows = await this.db
      .select()
      .from(products)
      .where(
        and(eq(products.tenantId, tenantId), onlyActive ? eq(products.active, true) : undefined),
      )
      .orderBy(asc(products.name));
    const prices = rows.length
      ? await this.db
          .select()
          .from(productPrices)
          .where(
            and(
              inArray(
                productPrices.productId,
                rows.map((p) => p.id),
              ),
              eq(productPrices.active, true),
            ),
          )
          .orderBy(desc(productPrices.amountMinor), asc(productPrices.code))
      : [];
    return rows.map((p) =>
      toProductDto(
        p,
        prices.filter((price) => price.productId === p.id),
        tenant.currency,
        view,
      ),
    );
  }

  /** Whether an affiliate earns a personally negotiated rate on every trip. */
  async hasNegotiatedRate(affiliateId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ rate: affiliates.commissionRateBpsOverride })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId));
    return row?.rate !== null && row?.rate !== undefined;
  }

  async product(tenantId: string, productId: string, db: DbOrTx = this.db): Promise<Product> {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)));
    if (!product) throw new NotFound('product');
    return product;
  }

  async productDto(tenantId: string, productId: string): Promise<ProductDto> {
    const list = await this.listProducts(tenantId, false);
    const product = list.find((p) => p.id === productId);
    if (!product) throw new NotFound('product');
    return product;
  }

  async productBySlug(tenantId: string, slug: string, view: ProductView): Promise<ProductDto> {
    const list = await this.listProducts(tenantId, true, view);
    const product = list.find((p) => p.slug === slug);
    if (!product) throw new NotFound('product');
    return product;
  }

  async createProduct(tenantId: string, body: CreateProductBody): Promise<ProductDto> {
    const codes = new Set(body.prices.map((p) => p.code));
    if (codes.size !== body.prices.length) {
      throw new DomainError('errors.catalog.duplicatePriceCode', HttpStatus.BAD_REQUEST);
    }
    const id = await this.db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          tenantId,
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          durationMinutes: body.durationMinutes,
          meetingPoint: body.meetingPoint ?? null,
          ...extrasChanges(body),
        })
        .onConflictDoNothing()
        .returning({ id: products.id });
      if (!product)
        throw new DomainError('errors.catalog.slugTaken', HttpStatus.CONFLICT, undefined, {
          slug: body.slug,
        });
      await tx.insert(productPrices).values(
        body.prices.map((price) => ({
          ...price,
          seats: price.kind === 'extra' ? 0 : price.seats,
          tenantId,
          productId: product.id,
        })),
      );
      return product.id;
    });
    return this.productDto(tenantId, id);
  }

  /** Edits a trip and, optionally, replaces its price list (see UpdateProductBody). */
  async updateProduct(
    tenantId: string,
    productId: string,
    body: UpdateProductBody,
  ): Promise<ProductDto> {
    const product = await this.product(tenantId, productId);
    if (product.sourceId) {
      // The operator's system owns the trip's name, prices and departures; the rest is ours.
      const { active, customerNote, questions, commissionRateBps, translations, ...rest } = body;
      if (Object.values(rest).some((v) => v !== undefined)) {
        throw new DomainError('errors.catalog.managedBySource', HttpStatus.CONFLICT);
      }
      const changes: Partial<typeof products.$inferInsert> = {
        ...extrasChanges({ customerNote, questions, commissionRateBps, translations }),
      };
      if (active !== undefined) changes.active = active;
      if (Object.keys(changes).length > 0) {
        await this.db.update(products).set(changes).where(eq(products.id, productId));
      }
      return this.productDto(tenantId, productId);
    }

    await this.db.transaction(async (tx) => {
      const changes: Partial<typeof products.$inferInsert> = extrasChanges(body);
      if (body.name !== undefined) changes.name = body.name;
      if (body.slug !== undefined && body.slug !== product.slug) {
        const [taken] = await tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.tenantId, tenantId),
              eq(products.slug, body.slug),
              ne(products.id, productId),
            ),
          );
        if (taken) {
          throw new DomainError('errors.catalog.slugTaken', HttpStatus.CONFLICT, undefined, {
            slug: body.slug,
          });
        }
        changes.slug = body.slug;
      }
      if (body.description !== undefined) changes.description = body.description || null;
      if (body.meetingPoint !== undefined) changes.meetingPoint = body.meetingPoint || null;
      if (body.active !== undefined) changes.active = body.active;
      if (body.durationMinutes !== undefined && body.durationMinutes !== product.durationMinutes) {
        changes.durationMinutes = body.durationMinutes;
        // Future departures end later or earlier with the new duration.
        await tx
          .update(slots)
          .set({ endsAt: sql`${slots.startsAt} + make_interval(mins => ${body.durationMinutes})` })
          .where(and(eq(slots.productId, productId), gt(slots.startsAt, this.clock.now())));
      }
      if (Object.keys(changes).length > 0) {
        await tx.update(products).set(changes).where(eq(products.id, productId));
      }
      if (body.prices) await this.replacePrices(tx, tenantId, productId, body.prices);
    });
    return this.productDto(tenantId, productId);
  }

  private async replacePrices(
    tx: Tx,
    tenantId: string,
    productId: string,
    next: NonNullable<UpdateProductBody['prices']>,
  ): Promise<void> {
    const existing = await tx
      .select()
      .from(productPrices)
      .where(eq(productPrices.productId, productId));
    const byId = new Map(existing.map((p) => [p.id, p]));
    const keptIds = new Set<string>();
    for (const price of next) {
      if (!price.id) continue;
      if (!byId.has(price.id)) throw new NotFound('price');
      if (keptIds.has(price.id)) {
        throw new DomainError('errors.catalog.duplicatePrice', HttpStatus.BAD_REQUEST);
      }
      keptIds.add(price.id);
    }
    // Codes are unique per trip, also against ticket types no longer sold.
    const usedCodes = new Set(existing.filter((p) => keptIds.has(p.id)).map((p) => p.code));
    const retired = new Map(existing.filter((p) => !keptIds.has(p.id)).map((p) => [p.code, p]));

    for (const price of existing) {
      if (!keptIds.has(price.id) && price.active) {
        await tx.update(productPrices).set({ active: false }).where(eq(productPrices.id, price.id));
      }
    }
    for (const price of next) {
      const fields = {
        label: price.label,
        amountMinor: price.amountMinor,
        taxRateBps: price.taxRateBps,
        // Extras take no seat.
        seats: price.kind === 'extra' ? 0 : price.seats,
        kind: price.kind,
        commissionable: price.commissionable,
        active: true,
      };
      if (price.id) {
        await tx.update(productPrices).set(fields).where(eq(productPrices.id, price.id));
        continue;
      }
      const base = price.code ?? codeFromLabel(price.label);
      let code = base;
      for (let i = 2; usedCodes.has(code); i++) code = `${base.slice(0, 36)}_${i}`;
      usedCodes.add(code);
      const old = retired.get(code);
      if (old) {
        // Same code as a ticket type no longer sold: bring that one back with the new values.
        retired.delete(code);
        await tx.update(productPrices).set(fields).where(eq(productPrices.id, old.id));
      } else {
        await tx.insert(productPrices).values({ ...fields, code, tenantId, productId });
      }
    }
  }

  async prices(
    tenantId: string,
    productId: string,
    priceIds: string[],
    db: DbOrTx = this.db,
  ): Promise<Price[]> {
    if (priceIds.length === 0) return [];
    return db
      .select()
      .from(productPrices)
      .where(
        and(
          eq(productPrices.tenantId, tenantId),
          eq(productPrices.productId, productId),
          eq(productPrices.active, true),
          inArray(productPrices.id, priceIds),
        ),
      );
  }

  /** Generates departures in the operator's timezone; existing departures are left untouched. */
  async createSlots(
    tenantId: string,
    productId: string,
    body: CreateSlotsBody,
  ): Promise<{ created: number }> {
    const tenant = await this.tenants.get(tenantId);
    const product = await this.product(tenantId, productId);
    if (product.sourceId) {
      throw new DomainError('errors.catalog.departuresFromSource', HttpStatus.CONFLICT);
    }
    const from = DateTime.fromISO(body.fromDate, { zone: tenant.timezone });
    const to = DateTime.fromISO(body.toDate, { zone: tenant.timezone });
    if (!from.isValid || !to.isValid || to < from) {
      throw new DomainError('errors.catalog.endBeforeStart', HttpStatus.BAD_REQUEST);
    }
    const values: (typeof slots.$inferInsert)[] = [];
    for (let day = from; day <= to; day = day.plus({ days: 1 })) {
      if (!body.weekdays.includes(day.weekday)) continue;
      for (const time of body.times) {
        const [hour, minute] = time.split(':').map(Number);
        const start = day.set({ hour, minute, second: 0, millisecond: 0 });
        values.push({
          tenantId,
          productId,
          startsAt: start.toJSDate(),
          endsAt: start.plus({ minutes: product.durationMinutes }).toJSDate(),
          capacity: body.capacity,
        });
      }
    }
    if (values.length > MAX_GENERATED_SLOTS) {
      throw new DomainError('errors.catalog.tooManyDepartures', HttpStatus.BAD_REQUEST, undefined, {
        max: MAX_GENERATED_SLOTS,
      });
    }
    if (values.length === 0) return { created: 0 };
    const created = await this.db
      .insert(slots)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: slots.id });
    return { created: created.length };
  }

  /** Departures between two local dates (inclusive) for the operator, closed ones included. */
  async listOperatorSlots(
    tenantId: string,
    productId: string,
    fromDate: string,
    toDate: string,
    now: Date,
  ): Promise<OperatorSlotDto[]> {
    const tenant = await this.tenants.get(tenantId);
    const product = await this.product(tenantId, productId);
    const { from, to } = localRange(fromDate, toDate, tenant.timezone);
    const start = from.toJSDate() > now ? from.toJSDate() : now;
    await this.sources.refreshSlots(product, from.toJSDate(), to.toJSDate());
    const rows = await this.db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.tenantId, tenantId),
          eq(slots.productId, productId),
          gte(slots.startsAt, start),
          lt(slots.startsAt, to.toJSDate()),
        ),
      )
      .orderBy(asc(slots.startsAt));
    return rows.map(toOperatorSlotDto);
  }

  /** Closes, reopens or resizes departures of an internal-calendar trip. */
  async updateSlots(
    tenantId: string,
    productId: string,
    body: UpdateSlotsBody,
  ): Promise<UpdateSlotsResultDto> {
    await this.assertOwnCalendar(tenantId, productId);
    return this.db.transaction(async (tx) => {
      const rows = await this.lockSlots(tx, tenantId, productId, body.slotIds);
      let capacityRaised = 0;
      const updated: OperatorSlotDto[] = [];
      for (const slot of rows) {
        const changes: Partial<typeof slots.$inferInsert> = {};
        if (body.closed !== undefined) changes.closed = body.closed;
        if (body.capacity !== undefined) {
          changes.capacity = Math.max(body.capacity, slot.reserved);
          if (changes.capacity !== body.capacity) capacityRaised += 1;
        }
        const [row] = await tx.update(slots).set(changes).where(eq(slots.id, slot.id)).returning();
        updated.push(toOperatorSlotDto(row!));
      }
      return { slots: updated, capacityRaised };
    });
  }

  /**
   * Deletes departures nobody booked. Departures with bookings (or seats on hold) are kept for
   * the tickets already sold and closed to new sales instead.
   */
  async deleteSlots(
    tenantId: string,
    productId: string,
    slotIds: string[],
  ): Promise<DeleteSlotsResultDto> {
    await this.assertOwnCalendar(tenantId, productId);
    return this.db.transaction(async (tx) => {
      const rows = await this.lockSlots(tx, tenantId, productId, slotIds);
      const ids = rows.map((r) => r.id);
      const booked = new Set(
        (
          await tx
            .selectDistinct({ slotId: bookings.slotId })
            .from(bookings)
            .where(inArray(bookings.slotId, ids))
        ).map((r) => r.slotId),
      );
      // `reserved` also counts seats on hold while a customer pays.
      const keep = rows.filter((r) => booked.has(r.id) || r.reserved > 0);
      const remove = rows.filter((r) => !keep.includes(r));
      if (remove.length > 0) {
        await tx.delete(slots).where(
          inArray(
            slots.id,
            remove.map((r) => r.id),
          ),
        );
      }
      if (keep.length > 0) {
        await tx
          .update(slots)
          .set({ closed: true })
          .where(
            inArray(
              slots.id,
              keep.map((r) => r.id),
            ),
          );
      }
      return { deleted: remove.length, closedInstead: keep.length };
    });
  }

  private async assertOwnCalendar(tenantId: string, productId: string): Promise<void> {
    const product = await this.product(tenantId, productId);
    if (product.sourceId) {
      throw new DomainError('errors.catalog.departuresFromSource', HttpStatus.CONFLICT);
    }
  }

  private async lockSlots(
    tx: Tx,
    tenantId: string,
    productId: string,
    slotIds: string[],
  ): Promise<(typeof slots.$inferSelect)[]> {
    const ids = [...new Set(slotIds)];
    const rows = await tx
      .select()
      .from(slots)
      .where(
        and(eq(slots.tenantId, tenantId), eq(slots.productId, productId), inArray(slots.id, ids)),
      )
      .orderBy(asc(slots.startsAt))
      .for('update');
    if (rows.length !== ids.length) throw new NotFound('departure');
    return rows;
  }

  /** Departures between two local dates (inclusive), with seats left. */
  async listSlots(
    tenantId: string,
    productId: string,
    fromDate: string,
    toDate: string,
    now: Date,
  ): Promise<SlotDto[]> {
    const tenant = await this.tenants.get(tenantId);
    const product = await this.product(tenantId, productId);
    const { from, to } = localRange(fromDate, toDate, tenant.timezone);
    const start = from.toJSDate() > now ? from.toJSDate() : now;
    await this.sources.refreshSlots(product, from.toJSDate(), to.toJSDate());
    const rows = await this.db
      .select()
      .from(slots)
      .where(
        and(
          eq(slots.tenantId, tenantId),
          eq(slots.productId, productId),
          eq(slots.closed, false),
          gte(slots.startsAt, start),
          lt(slots.startsAt, to.toJSDate()),
        ),
      )
      .orderBy(asc(slots.startsAt));
    return rows.map(toSlotDto);
  }
}

/** The customer note, questions, trip commission and translations of a create/update request. */
function extrasChanges(
  body: Pick<
    UpdateProductBody,
    'customerNote' | 'questions' | 'commissionRateBps' | 'translations'
  >,
): Partial<typeof products.$inferInsert> {
  const changes: Partial<typeof products.$inferInsert> = {};
  if (body.customerNote !== undefined) changes.customerNote = body.customerNote || null;
  if (body.questions !== undefined) changes.questions = body.questions;
  if (body.commissionRateBps !== undefined) changes.commissionRateBps = body.commissionRateBps;
  if (body.translations !== undefined) changes.translations = cleanTranslations(body.translations);
  return changes;
}

function localRange(
  fromDate: string,
  toDate: string,
  timezone: string,
): { from: DateTime; to: DateTime } {
  const from = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');
  const to = DateTime.fromISO(toDate, { zone: timezone }).plus({ days: 1 }).startOf('day');
  if (!from.isValid || !to.isValid || to <= from || to.diff(from, 'days').days > 62) {
    throw new DomainError('errors.catalog.rangeTooLong', HttpStatus.BAD_REQUEST, undefined, {
      days: 62,
    });
  }
  return { from, to };
}

/** A price code from a ticket label: "Copil (3-12 ani)" -> "copil_3_12_ani". */
export function codeFromLabel(label: string): string {
  const code = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return code || 'ticket';
}

export function toOperatorSlotDto(slot: typeof slots.$inferSelect): OperatorSlotDto {
  return { ...toSlotDto(slot), reserved: slot.reserved, closed: slot.closed };
}

export function toSlotDto(slot: typeof slots.$inferSelect): SlotDto {
  return {
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    capacity: slot.capacity,
    available: Math.max(0, slot.capacity - slot.reserved),
  };
}

export function toPriceDto(price: Price, label = price.label): PriceDto {
  return {
    id: price.id,
    code: price.code,
    label,
    amountMinor: price.amountMinor,
    taxRateBps: price.taxRateBps,
    seats: price.seats,
    kind: price.kind,
    commissionable: price.commissionable,
  };
}

export function toProductDto(
  product: Product,
  prices: Price[],
  currency: string,
  view: ProductView = OPERATOR_VIEW,
): ProductDto {
  const lang = view.kind === 'operator' ? null : view.lang;
  const priceDtos = prices.map((price) =>
    toPriceDto(price, localizedPriceLabel(product.translations, lang, price.id, price.label)),
  );
  const seatPrices = priceDtos
    .filter((p) => p.kind === 'ticket' && p.seats > 0 && p.amountMinor > 0)
    .map((p) => p.amountMinor);
  return {
    id: product.id,
    slug: product.slug,
    ...localizedTexts(product, lang),
    durationMinutes: product.durationMinutes,
    images: product.images,
    currency,
    prices: priceDtos,
    fromMinor: seatPrices.length ? Math.min(...seatPrices) : 0,
    managedExternally: product.sourceId !== null,
    active: product.active,
    questions: localizedQuestions(product.questions, product.translations, lang),
    commissionRateBps: view.kind === 'public' ? null : product.commissionRateBps,
    ...(view.kind === 'operator' ? { translations: product.translations } : {}),
  };
}
