import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Database,
  clicks,
  notifications,
  otpCodes,
  outboxEvents,
  processedWebhookEvents,
} from '@ap/db';
import { type SQL, getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { Clock } from '../common/clock';
import { DB } from '../database/database.module';

const DAY_MS = 24 * 60 * 60_000;

/** How long rows that only matter for a while are kept. */
export const RETENTION_DAYS = {
  /** Delivered internal events: only useful for debugging. */
  processedEvents: 30,
  /** Login codes expire in minutes; kept a day for the per-day limits. */
  loginCodes: 1,
  /** Stripe stops retrying a webhook after 3 days. */
  webhookEvents: 90,
  /** Sent and failed SMS/email (they hold phone numbers and emails). */
  notifications: 180,
  /** Link clicks: the operator's statistics show clicks for the last 13 months. */
  clicks: 400,
} as const;

/** Rows deleted per statement, so a big clean-up never locks a table for long. */
const BATCH = 5_000;

/**
 * Deletes rows that are no longer needed, so the tables that grow with every click, message
 * and event stay small. Bookings, tickets, payments and the commission ledger are never touched.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger('Cleanup');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<Record<string, number>> {
    const now = this.clock.now().getTime();
    const before = (days: number) => new Date(now - days * DAY_MS);
    const deleted = {
      processedEvents: await this.purge(
        outboxEvents,
        sql`processed_at is not null and processed_at < ${before(RETENTION_DAYS.processedEvents)}`,
      ),
      loginCodes: await this.purge(
        otpCodes,
        sql`created_at < ${before(RETENTION_DAYS.loginCodes)}`,
      ),
      webhookEvents: await this.purge(
        processedWebhookEvents,
        sql`processed_at < ${before(RETENTION_DAYS.webhookEvents)}`,
      ),
      notifications: await this.purge(
        notifications,
        sql`status in ('sent', 'failed') and created_at < ${before(RETENTION_DAYS.notifications)}`,
      ),
      clicks: await this.purge(clicks, sql`occurred_at < ${before(RETENTION_DAYS.clicks)}`),
    };
    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    if (total > 0) this.logger.log(`deleted old rows: ${JSON.stringify(deleted)}`);
    return deleted;
  }

  private async purge(table: PgTable, condition: SQL): Promise<number> {
    const name = sql.identifier(getTableName(table));
    let total = 0;
    for (;;) {
      const result = await this.db.execute(
        sql`delete from ${name} where ctid in (select ctid from ${name} where ${condition} limit ${BATCH})`,
      );
      const count = result.rowCount ?? 0;
      total += count;
      if (count < BATCH) return total;
    }
  }
}
