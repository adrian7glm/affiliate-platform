import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateDiscountCodeBody,
  DiscountCodeDto,
  DiscountPreviewDto,
  UpdateDiscountCodeBody,
} from '@ap/contracts';
import { type Database, affiliates, bookings, discountCodes, products } from '@ap/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { type Tenant, TenantsService } from '../common/tenants';
import { DB, type DbOrTx } from '../database/database.module';

export type DiscountCode = typeof discountCodes.$inferSelect;

/** Bookings that hold a use of their code; cancelled and expired ones give it back. */
const HOLDING = ['pending_payment', 'confirmed'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discount codes: the operator's own, and codes that belong to an affiliate (a hotel's guests). */
@Injectable()
export class DiscountsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
  ) {}

  /** The operator's codes, or only one affiliate's (`affiliateId`) or one code (`id`). */
  async list(
    tenantId: string,
    only: { affiliateId?: string; id?: string } = {},
  ): Promise<DiscountCodeDto[]> {
    const rows = await this.db
      .select({ code: discountCodes, affiliateName: affiliates.displayName })
      .from(discountCodes)
      .leftJoin(affiliates, eq(affiliates.id, discountCodes.affiliateId))
      .where(
        and(
          eq(discountCodes.tenantId, tenantId),
          only.affiliateId ? eq(discountCodes.affiliateId, only.affiliateId) : undefined,
          only.id ? eq(discountCodes.id, only.id) : undefined,
        ),
      )
      .orderBy(desc(discountCodes.createdAt));
    if (rows.length === 0) return [];
    const stats = await this.db
      .select({
        id: bookings.discountCodeId,
        uses: sql<number>`count(*) filter (where ${inArray(bookings.status, [...HOLDING])})::int`,
        revenue: sql<number>`coalesce(sum(${bookings.totalMinor}) filter (where ${bookings.status} = 'confirmed' and ${bookings.paidAt} is not null), 0)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          inArray(
            bookings.discountCodeId,
            rows.map((r) => r.code.id),
          ),
        ),
      )
      .groupBy(bookings.discountCodeId);
    const byId = new Map(stats.map((s) => [s.id, s]));
    return rows.map(({ code, affiliateName }) => ({
      id: code.id,
      code: code.code,
      percentBps: code.percentBps,
      amountMinor: code.amountMinor,
      affiliateId: code.affiliateId,
      affiliateName,
      productIds: code.productIds,
      validFrom: code.validFrom,
      validUntil: code.validUntil,
      maxUses: code.maxUses,
      active: code.active,
      uses: byId.get(code.id)?.uses ?? 0,
      revenueMinor: byId.get(code.id)?.revenue ?? 0,
      createdAt: code.createdAt.toISOString(),
    }));
  }

  async create(tenantId: string, body: CreateDiscountCodeBody): Promise<DiscountCodeDto> {
    await this.assertReferences(tenantId, body.affiliateId, body.productIds);
    const [created] = await this.db
      .insert(discountCodes)
      .values({
        tenantId,
        code: body.code,
        percentBps: body.percentBps ?? null,
        amountMinor: body.amountMinor ?? null,
        affiliateId: body.affiliateId ?? null,
        productIds: body.productIds ?? [],
        validFrom: body.validFrom ?? null,
        validUntil: body.validUntil ?? null,
        maxUses: body.maxUses ?? null,
        active: body.active ?? true,
      })
      .onConflictDoNothing()
      .returning({ id: discountCodes.id });
    if (!created) this.taken(body.code);
    return this.dto(tenantId, created!.id);
  }

  async update(
    tenantId: string,
    id: string,
    body: UpdateDiscountCodeBody,
  ): Promise<DiscountCodeDto> {
    const [current] = await this.db
      .select()
      .from(discountCodes)
      .where(and(eq(discountCodes.id, id), eq(discountCodes.tenantId, tenantId)));
    if (!current) throw new NotFound('discountCode');
    await this.assertReferences(tenantId, body.affiliateId, body.productIds);

    const changes: Partial<typeof discountCodes.$inferInsert> = {};
    if (body.code !== undefined && body.code !== current.code) {
      const [other] = await this.db
        .select({ id: discountCodes.id })
        .from(discountCodes)
        .where(
          and(
            eq(discountCodes.tenantId, tenantId),
            eq(discountCodes.code, body.code),
            ne(discountCodes.id, id),
          ),
        );
      if (other) this.taken(body.code);
      changes.code = body.code;
    }
    if (body.percentBps != null)
      Object.assign(changes, { percentBps: body.percentBps, amountMinor: null });
    if (body.amountMinor != null)
      Object.assign(changes, { amountMinor: body.amountMinor, percentBps: null });
    if (body.affiliateId !== undefined) changes.affiliateId = body.affiliateId;
    if (body.productIds !== undefined) changes.productIds = body.productIds;
    if (body.validFrom !== undefined) changes.validFrom = body.validFrom;
    if (body.validUntil !== undefined) changes.validUntil = body.validUntil;
    if (body.maxUses !== undefined) changes.maxUses = body.maxUses;
    if (body.active !== undefined) changes.active = body.active;
    const from = changes.validFrom !== undefined ? changes.validFrom : current.validFrom;
    const until = changes.validUntil !== undefined ? changes.validUntil : current.validUntil;
    if (from && until && from > until) {
      throw new DomainError('errors.discounts.datesReversed', HttpStatus.BAD_REQUEST);
    }
    if (Object.keys(changes).length > 0) {
      await this.db.update(discountCodes).set(changes).where(eq(discountCodes.id, id));
    }
    return this.dto(tenantId, id);
  }

  /** Public: whether a code works for a trip today, so the booking page can show the new price. */
  async preview(
    tenantSlug: string,
    typed: string,
    productId: unknown,
  ): Promise<DiscountPreviewDto> {
    const tenant = await this.tenants.bySlug(tenantSlug);
    if (typeof productId !== 'string' || !UUID.test(productId)) throw new NotFound('product');
    const code = await this.forBooking(this.db, tenant, typed, productId);
    if (!code) throw new DomainError('errors.discounts.invalid', HttpStatus.BAD_REQUEST);
    return { code: code.code, percentBps: code.percentBps, amountMinor: code.amountMinor };
  }

  /**
   * The code a customer typed, checked for a booking of this trip made today; null when they
   * typed none. A code of an affiliate who is no longer active stops working.
   */
  async forBooking(
    db: DbOrTx,
    tenant: Tenant,
    typed: string | undefined,
    productId: string,
  ): Promise<DiscountCode | null> {
    const text = typed?.trim().toUpperCase();
    if (!text) return null;
    const [row] = await db
      .select({ code: discountCodes, affiliateStatus: affiliates.status })
      .from(discountCodes)
      .leftJoin(affiliates, eq(affiliates.id, discountCodes.affiliateId))
      .where(and(eq(discountCodes.tenantId, tenant.id), eq(discountCodes.code, text)));
    const code = row?.code;
    if (!code?.active || (code.affiliateId && row?.affiliateStatus !== 'active')) {
      throw new DomainError('errors.discounts.invalid', HttpStatus.BAD_REQUEST);
    }
    const today = DateTime.fromJSDate(this.clock.now(), { zone: tenant.timezone }).toISODate()!;
    if (
      (code.validFrom && today < code.validFrom) ||
      (code.validUntil && today > code.validUntil)
    ) {
      throw new DomainError('errors.discounts.notToday', HttpStatus.BAD_REQUEST);
    }
    if (code.productIds.length > 0 && !code.productIds.includes(productId)) {
      throw new DomainError('errors.discounts.notForTrip', HttpStatus.BAD_REQUEST);
    }
    if (code.maxUses !== null && (await this.uses(db, code.id)) >= code.maxUses) {
      throw new DomainError('errors.discounts.usedUp', HttpStatus.BAD_REQUEST);
    }
    return code;
  }

  /**
   * Takes one use of a limited code inside the booking's transaction: the lock makes two customers
   * booking at the same moment queue, so only one of them gets its last use.
   */
  async claim(tx: DbOrTx, code: DiscountCode): Promise<void> {
    if (code.maxUses === null) return;
    await tx
      .select({ id: discountCodes.id })
      .from(discountCodes)
      .where(eq(discountCodes.id, code.id))
      .for('update');
    if ((await this.uses(tx, code.id)) >= code.maxUses) {
      throw new DomainError('errors.discounts.usedUp', HttpStatus.BAD_REQUEST);
    }
  }

  private async uses(db: DbOrTx, codeId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.discountCodeId, codeId), inArray(bookings.status, [...HOLDING])));
    return row?.count ?? 0;
  }

  private async dto(tenantId: string, id: string): Promise<DiscountCodeDto> {
    const [dto] = await this.list(tenantId, { id });
    if (!dto) throw new NotFound('discountCode');
    return dto;
  }

  private async assertReferences(
    tenantId: string,
    affiliateId: string | null | undefined,
    productIds: string[] | undefined,
  ): Promise<void> {
    if (affiliateId) {
      const [affiliate] = await this.db
        .select({ id: affiliates.id })
        .from(affiliates)
        .where(and(eq(affiliates.id, affiliateId), eq(affiliates.tenantId, tenantId)));
      if (!affiliate) throw new NotFound('affiliate');
    }
    const ids = [...new Set(productIds ?? [])];
    if (ids.length > 0) {
      const found = await this.db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), inArray(products.id, ids)));
      if (found.length !== ids.length) throw new NotFound('product');
    }
  }

  private taken(code: string): never {
    throw new DomainError('errors.discounts.codeTaken', HttpStatus.CONFLICT, undefined, { code });
  }
}
