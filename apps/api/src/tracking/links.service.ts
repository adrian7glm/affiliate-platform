import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClickResultDto, CreateLinkBody, LinkDto, RecordClickBody } from '@ap/contracts';
import {
  type Database,
  affiliateLinks,
  affiliates,
  bookings,
  clicks,
  products,
  tenants,
} from '@ap/db';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import { hashIp, randomCode } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { DB, type DbOrTx } from '../database/database.module';

/** Repeat clicks from the same visitor on the same link within this window count once. */
const DEDUPE_MS = 30 * 60_000;

export interface Attribution {
  affiliateId: string;
  linkId: string | null;
}

@Injectable()
export class LinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  url(code: string): string {
    return `${this.config.WEB_URL}/r/${code}`;
  }

  async create(
    db: DbOrTx,
    tenantId: string,
    affiliateId: string,
    body: CreateLinkBody,
  ): Promise<string> {
    if (body.productId) {
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, body.productId), eq(products.tenantId, tenantId)));
      if (!product) throw new NotFound('product');
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [link] = await db
        .insert(affiliateLinks)
        .values({
          tenantId,
          affiliateId,
          code: randomCode(7),
          productId: body.productId ?? null,
          label: body.label ?? null,
          campaign: body.campaign ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: affiliateLinks.id });
      if (link) return link.id;
    }
    throw new Error('could not generate a unique link code');
  }

  /** The affiliate's general link (no product), created on first use. */
  async primaryLinkId(db: DbOrTx, tenantId: string, affiliateId: string): Promise<string> {
    const [existing] = await db
      .select({ id: affiliateLinks.id })
      .from(affiliateLinks)
      .where(
        and(
          eq(affiliateLinks.affiliateId, affiliateId),
          isNull(affiliateLinks.productId),
          eq(affiliateLinks.active, true),
        ),
      )
      .orderBy(asc(affiliateLinks.createdAt))
      .limit(1);
    return existing?.id ?? this.create(db, tenantId, affiliateId, { label: 'General' });
  }

  async list(affiliateId: string, linkIds?: string[]): Promise<LinkDto[]> {
    const rows = await this.db
      .select({
        id: affiliateLinks.id,
        code: affiliateLinks.code,
        label: affiliateLinks.label,
        campaign: affiliateLinks.campaign,
        productId: affiliateLinks.productId,
        productName: products.name,
        active: affiliateLinks.active,
        clicks: sql<number>`(select count(*)::int from ${clicks} where ${clicks.linkId} = ${affiliateLinks.id} and ${clicks.counted})`,
        sales: sql<number>`(select count(*)::int from ${bookings} where ${bookings.linkId} = ${affiliateLinks.id} and ${bookings.status} = 'confirmed')`,
      })
      .from(affiliateLinks)
      .leftJoin(products, eq(products.id, affiliateLinks.productId))
      .where(
        and(
          eq(affiliateLinks.affiliateId, affiliateId),
          linkIds ? inArray(affiliateLinks.id, linkIds) : undefined,
        ),
      )
      .orderBy(asc(affiliateLinks.createdAt));
    return rows.map((r) => ({ ...r, url: this.url(r.code), qrUrl: `${this.url(r.code)}?s=qr` }));
  }

  async recordClick(
    code: string,
    body: RecordClickBody,
    ip: string | undefined,
  ): Promise<ClickResultDto> {
    const [link] = await this.db
      .select({
        id: affiliateLinks.id,
        tenantId: affiliateLinks.tenantId,
        affiliateId: affiliateLinks.affiliateId,
        tenantSlug: tenants.slug,
        window: tenants.attributionWindowDays,
        productSlug: products.slug,
      })
      .from(affiliateLinks)
      .innerJoin(affiliates, eq(affiliates.id, affiliateLinks.affiliateId))
      .innerJoin(tenants, eq(tenants.id, affiliateLinks.tenantId))
      .leftJoin(products, eq(products.id, affiliateLinks.productId))
      .where(
        and(
          eq(affiliateLinks.code, code.toUpperCase()),
          eq(affiliateLinks.active, true),
          inArray(affiliates.status, ['active', 'invited']),
        ),
      );
    if (!link) throw new NotFound('link');

    const now = this.clock.now();
    const [recent] = await this.db
      .select({ id: clicks.id })
      .from(clicks)
      .where(
        and(
          eq(clicks.linkId, link.id),
          eq(clicks.visitorId, body.visitorId),
          gt(clicks.occurredAt, new Date(now.getTime() - DEDUPE_MS)),
        ),
      )
      .limit(1);
    await this.db.insert(clicks).values({
      tenantId: link.tenantId,
      linkId: link.id,
      affiliateId: link.affiliateId,
      visitorId: body.visitorId,
      occurredAt: now,
      ipHash: hashIp(this.config.APP_SECRET, ip),
      userAgent: body.userAgent ?? null,
      referrer: body.referrer ?? null,
      counted: !recent,
    });
    return {
      tenantSlug: link.tenantSlug,
      productSlug: link.productSlug ?? null,
      attributionWindowDays: link.window,
    };
  }

  /**
   * Resolves the affiliate a public booking belongs to from the link code kept in the customer's
   * cookie. Unknown, inactive or foreign codes simply mean "no affiliate".
   */
  async attribution(
    db: DbOrTx,
    tenantId: string,
    code: string | undefined,
  ): Promise<Attribution | null> {
    if (!code) return null;
    const [link] = await db
      .select({ linkId: affiliateLinks.id, affiliateId: affiliateLinks.affiliateId })
      .from(affiliateLinks)
      .innerJoin(affiliates, eq(affiliates.id, affiliateLinks.affiliateId))
      .where(
        and(
          eq(affiliateLinks.code, code.toUpperCase()),
          eq(affiliateLinks.tenantId, tenantId),
          eq(affiliateLinks.active, true),
          eq(affiliates.status, 'active'),
        ),
      );
    return link ?? null;
  }

  async assertOwnLink(affiliateId: string, linkId: string): Promise<void> {
    const [link] = await this.db
      .select({ id: affiliateLinks.id })
      .from(affiliateLinks)
      .where(and(eq(affiliateLinks.id, linkId), eq(affiliateLinks.affiliateId, affiliateId)));
    if (!link) throw new DomainError('link not found', HttpStatus.NOT_FOUND);
  }
}
