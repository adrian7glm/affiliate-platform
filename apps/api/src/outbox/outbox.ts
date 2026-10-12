import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DomainEvent,
  type DomainEventType,
  type EventOfType,
  domainEvent,
} from '@ap/contracts';
import { type Database, outboxEvents } from '@ap/db';
import { eq, sql } from 'drizzle-orm';
import { DB, type DbOrTx, type Tx } from '../database/database.module';

export type EventHandler<T extends DomainEventType> = (
  event: EventOfType<T>,
  tx: Tx,
) => Promise<void>;

const MAX_ATTEMPTS = 10;

/**
 * Transactional outbox. `publish` writes the event in the caller's transaction, so the event
 * exists if and only if the change that caused it was committed. The dispatcher delivers each
 * event to its handlers inside one transaction together with marking it processed, so a handler's
 * writes are applied exactly once.
 */
@Injectable()
export class Outbox {
  private readonly logger = new Logger('Outbox');
  private readonly handlers = new Map<
    DomainEventType,
    { name: string; fn: EventHandler<DomainEventType> }[]
  >();
  private draining: Promise<number> | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  async publish(tx: DbOrTx, event: DomainEvent): Promise<void> {
    const parsed = domainEvent.parse(event);
    await tx
      .insert(outboxEvents)
      .values({ tenantId: parsed.tenantId, type: parsed.type, payload: parsed });
  }

  on<T extends DomainEventType>(type: T, name: string, fn: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push({ name, fn: fn as unknown as EventHandler<DomainEventType> });
    this.handlers.set(type, list);
  }

  /** Delivers every pending event; returns how many were processed. Concurrent calls share one run. */
  drain(): Promise<number> {
    if (!this.draining) {
      this.draining = this.drainAll().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  private async drainAll(): Promise<number> {
    let processed = 0;
    // A failed event is skipped for the rest of this run and retried on the next one.
    const skip: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const outcome = await this.processOne(skip);
      if (outcome === 'empty') break;
      if (outcome === 'processed') processed += 1;
    }
    return processed;
  }

  private async processOne(skip: number[]): Promise<'empty' | 'processed' | 'failed'> {
    let failed: { id: number; error: string } | null = null;
    const outcome = await this.db
      .transaction(async (tx) => {
        const rows = await tx.execute<{ id: number; type: string; payload: unknown }>(sql`
        select id, type, payload from outbox_events
        where processed_at is null and attempts < ${MAX_ATTEMPTS}
          ${
            skip.length
              ? sql`and id not in (${sql.join(
                  skip.map((id) => sql`${id}`),
                  sql`, `,
                )})`
              : sql``
          }
        order by id
        limit 1
        for update skip locked`);
        const row = rows.rows[0];
        if (!row) return 'empty' as const;

        const event = domainEvent.parse(row.payload);
        for (const handler of this.handlers.get(event.type) ?? []) {
          try {
            await tx.transaction(async (savepoint) => handler.fn(event, savepoint));
          } catch (error) {
            failed = { id: Number(row.id), error: `${handler.name}: ${(error as Error).message}` };
            throw error;
          }
        }
        await tx
          .update(outboxEvents)
          .set({ processedAt: new Date() })
          .where(eq(outboxEvents.id, Number(row.id)));
        return 'processed' as const;
      })
      .catch((error: unknown) => {
        if (!failed) throw error;
        return 'failed' as const;
      });

    if (outcome === 'failed' && failed) {
      const { id, error } = failed as { id: number; error: string };
      this.logger.error(`event ${id} failed: ${error}`);
      skip.push(id);
      await this.db
        .update(outboxEvents)
        .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: error })
        .where(eq(outboxEvents.id, id));
    }
    return outcome;
  }
}
