import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { tenants } from './identity';

/**
 * Addresses in other software (Zapier, Make, an accounting or CRM system) that the platform
 * notifies when something happens to a booking. Each request is signed with the endpoint's secret.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    /** Event types sent to this address; empty means every type. */
    events: text('events').array().notNull().default([]),
    /** Signing secret, encrypted with APP_SECRET (common/crypto.ts sealSecret). */
    secretEncrypted: text('secret_encrypted').notNull(),
    active: boolean('active').notNull().default(true),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** HTTP status of the last attempt; null when the address could not be reached. */
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_tenant').on(t.tenantId)],
);

export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'sending',
  'delivered',
  'failed',
]);

/**
 * One event for one endpoint. Written in the transaction that handled the event, sent by the
 * worker with retries; the payload is kept so every retry sends the same body.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    tenantId: uuid('tenant_id').notNull(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    /** Same for every endpoint that receives the event: receivers use it to ignore repeats. */
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_deliveries_endpoint_event').on(t.endpointId, t.eventId),
    index('webhook_deliveries_due').on(t.status, t.nextAttemptAt),
    index('webhook_deliveries_endpoint_created').on(t.endpointId, t.createdAt),
  ],
);
