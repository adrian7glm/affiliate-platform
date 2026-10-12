import {
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

export const notificationChannelEnum = pgEnum('notification_channel', ['email', 'sms']);
export const notificationStatusEnum = pgEnum('notification_status', [
  'queued',
  'sending',
  'sent',
  'failed',
]);

/**
 * Every SMS and email the platform sends. Messages are queued in the transaction that caused
 * them and delivered by the worker with retries, so a provider outage delays a ticket instead of
 * losing it. Login codes are sent at once and stored without their parameters (the code).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: uuid('tenant_id'),
    channel: notificationChannelEnum('channel').notNull(),
    recipient: text('recipient').notNull(),
    template: text('template').notNull(),
    locale: text('locale').notNull(),
    params: jsonb('params').notNull().default({}),
    /** Makes enqueueing idempotent, e.g. one ticket message per booking. */
    dedupeKey: text('dedupe_key'),
    status: notificationStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_due').on(t.status, t.nextAttemptAt),
    index('notifications_tenant_created').on(t.tenantId, t.createdAt),
    uniqueIndex('notifications_dedupe_key').on(t.dedupeKey),
  ],
);
