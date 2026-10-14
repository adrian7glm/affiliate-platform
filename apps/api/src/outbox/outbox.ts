import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DomainEvent,
  type DomainEventType,
  type EventOfType,
  domainEvent,
} from '@ap/contracts';
import { type Database, outboxEvents } from '@ap/db';
import { eq, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DB, type DbOrTx, type Tx } from '../database/database.module';

export type EventHandler<T extends DomainEventType> = (
  event: EventOfType<T>,
  tx: Tx,
) => Promise<void>;

/** After this many failures an event stops being retried and the platform admins are told. */
export const MAX_ATTEMPTS = 10;

/** Wait before the next attempt: 5 s, 10 s, 20 s… up to an hour (about 1.5 h for all 10). */
export function retryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export interface DeadEvent {
  id: number;
  type: string;
  tenantId: string | null;
  error: string;
}
export type DeadEventHandler = (event: DeadEvent) => Promise<void>;

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
  private readonly deadHandlers: DeadEventHandler[] = [];
  private draining: Promise<number> | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

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

  /** Called once when an event has failed MAX_ATTEMPTS times and will not be retried. */
  onDeadEvent(fn: DeadEventHandler): void {
    this.deadHandlers.push(fn);
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
          and (next_attempt_at is null or next_attempt_at <= ${this.clock.now()})
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
          .set({ processedAt: this.clock.now() })
          .where(eq(outboxEvents.id, Number(row.id)));
        return 'processed' as const;
      })
      .catch((error: unknown) => {
        if (!failed) throw error;
        return 'failed' as const;
      });

    if (outcome === 'failed' && failed) {
      const { id, error } = failed as { id: number; error: string };
      skip.push(id);
      const [row] = await this.db
        .update(outboxEvents)
        .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: error })
        .where(eq(outboxEvents.id, id))
        .returning({
          attempts: outboxEvents.attempts,
          type: outboxEvents.type,
          tenantId: outboxEvents.tenantId,
        });
      const attempts = row?.attempts ?? MAX_ATTEMPTS;
      if (attempts < MAX_ATTEMPTS) {
        this.logger.warn(`event ${id} failed (attempt ${attempts}): ${error}`);
        await this.db
          .update(outboxEvents)
          .set({ nextAttemptAt: new Date(this.clock.now().getTime() + retryDelayMs(attempts)) })
          .where(eq(outboxEvents.id, id));
      } else {
        this.logger.error(`event ${id} failed ${attempts} times, giving up: ${error}`);
        await this.reportDead({
          id,
          type: row?.type ?? 'unknown',
          tenantId: row?.tenantId ?? null,
          error,
        });
      }
    }
    return outcome;
  }

  /** Events that stopped being retried, newest first (for the platform admin). */
  async dead(limit = 100) {
    return this.db
      .select({
        id: outboxEvents.id,
        type: outboxEvents.type,
        tenantId: outboxEvents.tenantId,
        attempts: outboxEvents.attempts,
        lastError: outboxEvents.lastError,
        occurredAt: outboxEvents.occurredAt,
      })
      .from(outboxEvents)
      .where(
        sql`${outboxEvents.processedAt} is null and ${outboxEvents.attempts} >= ${MAX_ATTEMPTS}`,
      )
      .orderBy(sql`${outboxEvents.id} desc`)
      .limit(limit);
  }

  /** Gives a stopped event a fresh set of attempts, e.g. after the cause was fixed. */
  async retry(id: number): Promise<boolean> {
    const rows = await this.db
      .update(outboxEvents)
      .set({ attempts: 0, nextAttemptAt: null })
      .where(sql`${outboxEvents.id} = ${id} and ${outboxEvents.processedAt} is null`)
      .returning({ id: outboxEvents.id });
    return rows.length > 0;
  }

  private async reportDead(event: DeadEvent): Promise<void> {
    for (const handler of this.deadHandlers) {
      await handler(event).catch((error: unknown) =>
        this.logger.error(`dead event ${event.id}: alert failed: ${(error as Error).message}`),
      );
    }
  }
}
