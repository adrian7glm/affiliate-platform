import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateProductBody,
  CreateSlotsBody,
  PriceDto,
  ProductDto,
  SlotDto,
} from '@ap/contracts';
import { type Database, productPrices, products, slots } from '@ap/db';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DomainError, NotFound } from '../common/errors';
import { TenantsService } from '../common/tenants';
import { DB, type DbOrTx } from '../database/database.module';

export type Product = typeof products.$inferSelect;
export type Price = typeof productPrices.$inferSelect;

const MAX_GENERATED_SLOTS = 2000;

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tenants: TenantsService,
  ) {}

  async listProducts(tenantId: string, onlyActive = true): Promise<ProductDto[]> {
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
          .orderBy(asc(productPrices.amountMinor))
      : [];
    return rows.map((p) =>
      toProductDto(
        p,
        prices.filter((price) => price.productId === p.id),
        tenant.currency,
      ),
    );
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

  async productBySlug(tenantId: string, slug: string): Promise<ProductDto> {
    const list = await this.listProducts(tenantId);
    const product = list.find((p) => p.slug === slug);
    if (!product) throw new NotFound('product');
    return product;
  }

  async createProduct(tenantId: string, body: CreateProductBody): Promise<ProductDto> {
    const codes = new Set(body.prices.map((p) => p.code));
    if (codes.size !== body.prices.length) {
      throw new DomainError('each price needs a different code', HttpStatus.BAD_REQUEST);
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
        })
        .onConflictDoNothing()
        .returning({ id: products.id });
      if (!product)
        throw new DomainError(
          `a product with the address "${body.slug}" already exists`,
          HttpStatus.CONFLICT,
        );
      await tx
        .insert(productPrices)
        .values(body.prices.map((price) => ({ ...price, tenantId, productId: product.id })));
      return product.id;
    });
    return this.productDto(tenantId, id);
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
    const from = DateTime.fromISO(body.fromDate, { zone: tenant.timezone });
    const to = DateTime.fromISO(body.toDate, { zone: tenant.timezone });
    if (!from.isValid || !to.isValid || to < from) {
      throw new DomainError(
        'the end date must be on or after the start date',
        HttpStatus.BAD_REQUEST,
      );
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
      throw new DomainError(
        `at most ${MAX_GENERATED_SLOTS} departures at once`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (values.length === 0) return { created: 0 };
    const created = await this.db
      .insert(slots)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: slots.id });
    return { created: created.length };
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
    await this.product(tenantId, productId);
    const from = DateTime.fromISO(fromDate, { zone: tenant.timezone }).startOf('day');
    const to = DateTime.fromISO(toDate, { zone: tenant.timezone }).plus({ days: 1 }).startOf('day');
    if (!from.isValid || !to.isValid || to <= from || to.diff(from, 'days').days > 62) {
      throw new DomainError('choose a range of at most 62 days', HttpStatus.BAD_REQUEST);
    }
    const start = from.toJSDate() > now ? from.toJSDate() : now;
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

export function toSlotDto(slot: typeof slots.$inferSelect): SlotDto {
  return {
    id: slot.id,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    capacity: slot.capacity,
    available: Math.max(0, slot.capacity - slot.reserved),
  };
}

export function toPriceDto(price: Price): PriceDto {
  return {
    id: price.id,
    code: price.code,
    label: price.label,
    amountMinor: price.amountMinor,
    taxRateBps: price.taxRateBps,
    seats: price.seats,
  };
}

export function toProductDto(product: Product, prices: Price[], currency: string): ProductDto {
  const priceDtos = prices.map(toPriceDto);
  const seatPrices = priceDtos
    .filter((p) => p.seats > 0 && p.amountMinor > 0)
    .map((p) => p.amountMinor);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    durationMinutes: product.durationMinutes,
    meetingPoint: product.meetingPoint,
    images: product.images,
    currency,
    prices: priceDtos,
    fromMinor: seatPrices.length ? Math.min(...seatPrices) : 0,
  };
}
