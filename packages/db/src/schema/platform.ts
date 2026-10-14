import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';

/**
 * Transactional outbox: domain events are written in the same transaction as the change that
 * caused them, then delivered to other modules by the worker. Nothing is lost if a process dies.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** After a failure the event waits before the next attempt (backoff); null: right away. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  },
  (t) => [index('outbox_events_unprocessed').on(t.processedAt, t.id)],
);

/** Last time each background job ran, so /health can tell whether the worker is alive. */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  job: text('job').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  lastError: text('last_error'),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_entity').on(t.entityType, t.entityId)],
);

/** Platform-wide switches the platform owner changes from the admin area, e.g. SMS sign-in. */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
