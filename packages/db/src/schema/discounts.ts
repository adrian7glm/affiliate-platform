import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants } from './identity';
import { affiliates } from './affiliates';

/**
 * A code customers type at booking for a lower price. Either a percentage or a fixed amount
 * off the booking; it can belong to an affiliate (a hotel gives it to its guests), and then the
 * booking is theirs. Uses are counted from the bookings that hold it, so an expired or cancelled
 * booking gives its use back.
 */
export const discountCodes = pgTable(
  'discount_codes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Upper case, as typed by customers in any case. */
    code: text('code').notNull(),
    percentBps: integer('percent_bps'),
    amountMinor: integer('amount_minor'),
    affiliateId: uuid('affiliate_id').references(() => affiliates.id, { onDelete: 'set null' }),
    /** Trips it applies to; empty: all of them. */
    productIds: jsonb('product_ids').$type<string[]>().notNull().default([]),
    /** First and last day it can be used, in the operator's timezone. */
    validFrom: date('valid_from', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }),
    maxUses: integer('max_uses'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('discount_codes_tenant_code').on(t.tenantId, t.code),
    index('discount_codes_affiliate').on(t.affiliateId),
    check('discount_codes_one_kind', sql`(${t.percentBps} is null) <> (${t.amountMinor} is null)`),
    check(
      'discount_codes_values',
      sql`(${t.percentBps} is null or ${t.percentBps} between 1 and 9000) and (${t.amountMinor} is null or ${t.amountMinor} > 0) and (${t.maxUses} is null or ${t.maxUses} > 0)`,
    ),
  ],
);
