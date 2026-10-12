import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AvailabilityProvider,
  HoldExpiredError,
  type ProviderProduct,
  RestProvider,
  SoldOutError,
} from '@ap/adapters';
import type { ConnectSourceBody, EventOfType, SourceDto, SyncResultDto } from '@ap/contracts';
import {
  type Database,
  auditLog,
  availabilitySources,
  bookings,
  holds,
  productPrices,
  products,
  slots,
} from '@ap/db';
import { and, count, eq, gte, lt, notInArray, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { openSecret, sealSecret } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx, type Tx } from '../database/database.module';

type Source = typeof availabilitySources.$inferSelect;
type Product = typeof products.$inferSelect;
type Slot = typeof slots.$inferSelect;

/** How far ahead departures are imported by a full sync. */
const SYNC_DAYS = 60;
/** A listing re-reads availability from the operator's system at most this often. */
const REFRESH_AFTER_MS = 60_000;
/** Hold taken again for a payment that arrived after the first hold expired. */
const LATE_HOLD_SECONDS = 300;

function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'excursie';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Operators that run their own booking system: their trips, prices and departures are imported
 * from it, and seats are held, confirmed and cancelled in it through @ap/adapters. Local slots are
 * a cache of their availability; the operator's system always has the last word on seats.
 */
@Injectable()
export class SourcesService {
  private readonly logger = new Logger('Sources');
  private readonly providers = new Map<string, AvailabilityProvider>();
  private readonly refreshedAt = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Connecting and syncing
  // ---------------------------------------------------------------------------------------------

  async list(tenantId: string): Promise<SourceDto[]> {
    const rows = await this.db
      .select()
      .from(availabilitySources)
      .where(eq(availabilitySources.tenantId, tenantId))
      .orderBy(availabilitySources.createdAt);
    const counts = await this.db
      .select({ sourceId: products.sourceId, total: count() })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.active, true)))
      .groupBy(products.sourceId);
    return rows.map((source) => ({
      id: source.id,
      kind: source.kind,
      name: source.name,
      baseUrl: typeof source.config.baseUrl === 'string' ? source.config.baseUrl : null,
      active: source.active,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      productCount: counts.find((c) => c.sourceId === source.id)?.total ?? 0,
    }));
  }

  /** Checks the operator's API answers with this token, saves it and imports the trips. */
  async connect(tenantId: string, body: ConnectSourceBody): Promise<SourceDto> {
    if (this.config.NODE_ENV === 'production' && !body.baseUrl.startsWith('https://')) {
      throw new DomainError('the address must start with https://', HttpStatus.BAD_REQUEST);
    }
    const provider = this.restProvider(body.baseUrl, body.token);
    try {
      await provider.listProducts();
    } catch (error) {
      throw new DomainError(
        `could not read the trips from ${body.baseUrl}: ${message(error)}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const [source] = await this.db
      .insert(availabilitySources)
      .values({
        tenantId,
        kind: 'rest',
        name: body.name,
        config: { baseUrl: body.baseUrl },
        credentialsEncrypted: sealSecret(this.config.APP_SECRET, body.token),
      })
      .returning();
    await this.sync(tenantId, source!.id);
    const dto = (await this.list(tenantId)).find((s) => s.id === source!.id);
    return dto!;
  }

  /** Imports trips, prices and the next departures from the operator's system. */
  async sync(tenantId: string, sourceId: string): Promise<SyncResultDto> {
    const source = await this.source(sourceId, tenantId);
    const provider = this.provider(source);
    let remote: ProviderProduct[];
    try {
      remote = await provider.listProducts();
    } catch (error) {
      throw this.unavailable(source, error);
    }
    const now = this.clock.now();
    const until = new Date(now.getTime() + SYNC_DAYS * 86_400_000);
    let slotCount = 0;
    const externalIds: string[] = [];
    for (const item of remote) {
      const product = await this.upsertProduct(source, item);
      externalIds.push(item.externalId);
      try {
        slotCount += await this.syncSlots(provider, product, now, until);
      } catch (error) {
        throw this.unavailable(source, error);
      }
    }
    await this.db
      .update(products)
      .set({ active: false })
      .where(
        and(
          eq(products.sourceId, source.id),
          externalIds.length ? notInArray(products.externalId, externalIds) : undefined,
        ),
      );
    await this.db
      .update(availabilitySources)
      .set({ lastSyncedAt: now })
      .where(eq(availabilitySources.id, source.id));
    return { products: remote.length, slots: slotCount };
  }

  /** Background sync of every connected system. */
  async syncAll(): Promise<void> {
    const rows = await this.db
      .select()
      .from(availabilitySources)
      .where(and(eq(availabilitySources.kind, 'rest'), eq(availabilitySources.active, true)));
    for (const source of rows) {
      try {
        await this.sync(source.tenantId, source.id);
      } catch (error) {
        this.logger.warn(`sync of source ${source.id} failed: ${message(error)}`);
      }
    }
  }

  /**
   * Re-reads the departures of an imported trip before they are shown, at most once a minute per
   * range. If the operator's system does not answer, the last known availability is shown.
   */
  async refreshSlots(product: Product, from: Date, to: Date): Promise<void> {
    if (!product.sourceId || !product.externalId) return;
    const now = this.clock.now();
    const start = from > now ? from : now;
    if (start >= to) return;
    const key = `${product.id}:${from.toISOString()}:${to.toISOString()}`;
    if (now.getTime() - (this.refreshedAt.get(key) ?? 0) < REFRESH_AFTER_MS) return;
    if (this.refreshedAt.size > 5_000) this.refreshedAt.clear();
    this.refreshedAt.set(key, now.getTime());
    try {
      const source = await this.source(product.sourceId);
      await this.syncSlots(this.provider(source), product, start, to);
    } catch (error) {
      this.logger.warn(`availability refresh for product ${product.id} failed: ${message(error)}`);
    }
  }

  private async upsertProduct(source: Source, item: ProviderProduct): Promise<Product> {
    const [existing] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, source.tenantId), eq(products.externalId, item.externalId)));
    let product: Product;
    if (existing) {
      [product] = (await this.db
        .update(products)
        .set({
          sourceId: source.id,
          name: item.name,
          durationMinutes: item.durationMinutes,
          active: true,
        })
        .where(eq(products.id, existing.id))
        .returning()) as [Product];
    } else {
      [product] = (await this.db
        .insert(products)
        .values({
          tenantId: source.tenantId,
          sourceId: source.id,
          externalId: item.externalId,
          slug: await this.uniqueSlug(source.tenantId, slugify(item.name)),
          name: item.name,
          durationMinutes: item.durationMinutes,
        })
        .returning()) as [Product];
    }

    for (const price of item.prices) {
      await this.db
        .insert(productPrices)
        .values({
          tenantId: source.tenantId,
          productId: product.id,
          code: price.code,
          label: price.label,
          amountMinor: price.amountMinor,
          taxRateBps: price.taxRateBps,
        })
        .onConflictDoUpdate({
          target: [productPrices.productId, productPrices.code],
          set: {
            label: price.label,
            amountMinor: price.amountMinor,
            taxRateBps: price.taxRateBps,
            active: true,
          },
        });
    }
    const codes = item.prices.map((p) => p.code);
    await this.db
      .update(productPrices)
      .set({ active: false })
      .where(
        and(
          eq(productPrices.productId, product.id),
          codes.length ? notInArray(productPrices.code, codes) : undefined,
        ),
      );
    return product;
  }

  private async uniqueSlug(tenantId: string, base: string): Promise<string> {
    for (let n = 1; ; n += 1) {
      const slug = n === 1 ? base : `${base}-${n}`;
      const [taken] = await this.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.slug, slug)));
      if (!taken) return slug;
    }
  }

  /** Mirrors the operator's departures in [from, to); departures they removed are closed. */
  private async syncSlots(
    provider: AvailabilityProvider,
    product: Product,
    from: Date,
    to: Date,
  ): Promise<number> {
    const remote = await provider.getAvailability(product.externalId!, from, to);
    const now = this.clock.now();
    for (const slot of remote) {
      const reserved = Math.max(0, slot.capacity - Math.min(slot.available, slot.capacity));
      await this.db
        .insert(slots)
        .values({
          tenantId: product.tenantId,
          productId: product.id,
          externalId: slot.externalId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          capacity: slot.capacity,
          reserved,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [slots.productId, slots.startsAt],
          set: {
            externalId: slot.externalId,
            endsAt: slot.endsAt,
            capacity: slot.capacity,
            reserved,
            closed: false,
            syncedAt: now,
          },
        });
    }
    await this.db
      .update(slots)
      .set({ closed: true, syncedAt: now })
      .where(
        and(
          eq(slots.productId, product.id),
          gte(slots.startsAt, from),
          lt(slots.startsAt, to),
          remote.length
            ? notInArray(
                slots.startsAt,
                remote.map((s) => s.startsAt),
              )
            : undefined,
        ),
      );
    return remote.length;
  }

  // ---------------------------------------------------------------------------------------------
  // Seats in the operator's system
  // ---------------------------------------------------------------------------------------------

  /** Holds seats in the operator's system while the customer pays. Returns their hold id. */
  async hold(product: Product, slot: Slot, seats: number, ttlSeconds: number): Promise<string> {
    const source = await this.source(product.sourceId!);
    try {
      const result = await this.provider(source).hold({
        productExternalId: product.externalId!,
        slotExternalId: slot.externalId,
        startsAt: slot.startsAt,
        seats,
        ttlSeconds,
      });
      return result.holdId;
    } catch (error) {
      if (error instanceof SoldOutError) {
        await this.db
          .update(slots)
          .set({
            reserved: sql`greatest(${slots.capacity} - ${error.available}, 0)`,
            syncedAt: this.clock.now(),
          })
          .where(eq(slots.id, slot.id));
        throw new DomainError(
          `only ${error.available} seats left on this departure`,
          HttpStatus.CONFLICT,
          { available: error.available },
        );
      }
      throw this.unavailable(source, error);
    }
  }

  /** Frees a hold that will not be paid. Best effort: the operator's system also expires it. */
  async release(productId: string, externalHoldId: string): Promise<void> {
    try {
      const [product] = await this.db.select().from(products).where(eq(products.id, productId));
      if (!product?.sourceId) return;
      await this.provider(await this.source(product.sourceId)).release(externalHoldId);
    } catch (error) {
      this.logger.warn(`could not release hold ${externalHoldId}: ${message(error)}`);
    }
  }

  /** Cancels a booking in the operator's system. Fails if their system does not answer. */
  async cancel(productId: string, externalRef: string): Promise<void> {
    const [product] = await this.db.select().from(products).where(eq(products.id, productId));
    if (!product?.sourceId) return;
    const source = await this.source(product.sourceId);
    try {
      await this.provider(source).cancel(externalRef);
    } catch (error) {
      throw this.unavailable(source, error);
    }
  }

  /**
   * Outbox handler: turns the hold of a paid (or pay-at-boarding) booking into a booking in the
   * operator's system. A failure is retried by the outbox; confirming twice is safe by contract.
   */
  async confirm(event: EventOfType<'booking.seats_confirmed'>, tx: Tx): Promise<void> {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, event.bookingId))
      .for('update');
    if (!booking || booking.status !== 'confirmed' || booking.externalRef) return;
    const [product] = await tx.select().from(products).where(eq(products.id, booking.productId));
    if (!product?.sourceId || !product.externalId) return;
    const provider = this.provider(await this.source(product.sourceId, undefined, tx));
    const [hold] = booking.holdId
      ? await tx.select().from(holds).where(eq(holds.id, booking.holdId))
      : [];
    const request = {
      reference: booking.reference,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      seats: booking.seats,
    };

    let externalRef: string;
    try {
      if (!hold?.externalHoldId) throw new HoldExpiredError('none');
      ({ externalRef } = await provider.confirm({ holdId: hold.externalHoldId, ...request }));
    } catch (error) {
      if (!(error instanceof HoldExpiredError)) throw error;
      // The money arrived after the hold expired: take the seats again if they are still free.
      const [slot] = await tx.select().from(slots).where(eq(slots.id, booking.slotId));
      try {
        const again = await provider.hold({
          productExternalId: product.externalId,
          slotExternalId: slot?.externalId ?? null,
          startsAt: booking.startsAt,
          seats: booking.seats,
          ttlSeconds: LATE_HOLD_SECONDS,
        });
        ({ externalRef } = await provider.confirm({ holdId: again.holdId, ...request }));
      } catch (late) {
        if (!(late instanceof SoldOutError)) throw late;
        this.logger.warn(`booking ${booking.id} was paid but the departure is now full`);
        await tx.insert(auditLog).values({
          tenantId: booking.tenantId,
          action: 'overbooked_after_late_payment',
          entityType: 'booking',
          entityId: booking.id,
          data: { seats: booking.seats, available: late.available, sourceId: product.sourceId },
        });
        return;
      }
    }
    await tx.update(bookings).set({ externalRef }).where(eq(bookings.id, booking.id));
  }

  // ---------------------------------------------------------------------------------------------

  private async source(sourceId: string, tenantId?: string, db: DbOrTx = this.db): Promise<Source> {
    const [source] = await db
      .select()
      .from(availabilitySources)
      .where(
        and(
          eq(availabilitySources.id, sourceId),
          tenantId ? eq(availabilitySources.tenantId, tenantId) : undefined,
        ),
      );
    if (!source) throw new NotFound('availability source');
    return source;
  }

  private provider(source: Source): AvailabilityProvider {
    const key = `${source.id}:${source.credentialsEncrypted ?? ''}`;
    let provider = this.providers.get(key);
    if (!provider) {
      const baseUrl = String(source.config.baseUrl ?? '');
      const token = source.credentialsEncrypted
        ? openSecret(this.config.APP_SECRET, source.credentialsEncrypted)
        : undefined;
      provider = this.restProvider(baseUrl, token);
      this.providers.set(key, provider);
    }
    return provider;
  }

  private restProvider(baseUrl: string, token: string | undefined): AvailabilityProvider {
    return new RestProvider({ baseUrl, token });
  }

  private unavailable(source: Source, error: unknown): DomainError {
    this.logger.warn(`source ${source.id} (${source.name}) failed: ${message(error)}`);
    return new DomainError(
      `${source.name} did not answer, try again in a minute`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
