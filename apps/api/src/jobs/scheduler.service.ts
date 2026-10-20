import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Database, DbHandle } from '@ap/db';
import { BookingService } from '../booking/booking.service';
import { Clock } from '../common/clock';
import { reportError } from '../common/error-reporting';
import { CommissionLedgerService } from '../commissions/ledger.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, DB_HANDLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { Outbox } from '../outbox/outbox';
import { RetentionService } from '../retention/retention.service';
import { SourcesService } from '../sources/sources.service';
import { CleanupService } from './cleanup.service';
import { JOBS, type JobName, recordHeartbeat } from './jobs';

/** A job's heartbeat is written at most this often (the outbox runs every 3 seconds). */
const HEARTBEAT_EVERY_MS = 30_000;
/**
 * Held by the one worker process that runs the jobs. Run exactly one worker; a second one started
 * by mistake (or during a rolling deploy) stands by and takes over only when the first one stops.
 */
const SCHEDULER_LOCK = 7_042_027;
/** How often a standby worker tries to take over. */
const STANDBY_RETRY_MS = 15_000;

/** The pooled connection that holds the lock: the lock lasts as long as the connection. */
interface LockConnection {
  query(text: string, values: unknown[]): Promise<{ rows: { locked: boolean }[] }>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  release(destroy?: boolean): void;
}

/**
 * Background work, run when WORKER_ENABLED=true: in the API process for local development, or in
 * the dedicated worker process (`node dist/worker.js`) in production, so the public API never
 * waits behind a slow job and a second API server does not run every job twice.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Scheduler');
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly lastHeartbeat = new Map<JobName, number>();
  private lock: LockConnection | null = null;
  private standby: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly bookingService: BookingService,
    private readonly commissions: CommissionLedgerService,
    private readonly sources: SourcesService,
    private readonly notifications: NotificationsService,
    private readonly cleanup: CleanupService,
    private readonly webhooks: WebhooksService,
    private readonly retention: RetentionService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORKER_ENABLED) return;
    void this.lead();
  }

  /**
   * Starts the jobs once this process holds the scheduler lock, so two workers never run them
   * side by side (two senders could each send a slow message whose lease ran out).
   */
  async lead(): Promise<boolean> {
    if (this.stopped || this.lock) return this.lock !== null;
    let connection: LockConnection | null = null;
    try {
      connection = (await this.handle.pool.connect()) as LockConnection;
      const { rows } = await connection.query('select pg_try_advisory_lock($1) as locked', [
        SCHEDULER_LOCK,
      ]);
      if (rows[0]?.locked && !this.stopped) {
        if (this.standby) clearTimeout(this.standby);
        const held = connection;
        this.lock = held;
        held.on('error', (error) => this.lostLock(held, error));
        this.startJobs();
        return true;
      }
      connection.release(true);
    } catch (error) {
      connection?.release(true);
      this.logger.warn(`scheduler lock not taken: ${(error as Error).message}`);
    }
    if (!this.stopped) {
      if (!this.standby) this.logger.log('another worker runs the background jobs; standing by');
      this.standby = setTimeout(() => void this.lead(), STANDBY_RETRY_MS);
      this.standby.unref();
    }
    return false;
  }

  /** The lock's connection broke, so the lock is gone: stop, and stand by to take it back. */
  private lostLock(connection: LockConnection, error: Error): void {
    if (this.lock !== connection) return;
    this.logger.error(`scheduler lock lost: ${error.message}`);
    this.stopJobs();
    this.lock = null;
    connection.release(true);
    void this.lead();
  }

  private startJobs(): void {
    this.every('outbox', () => this.outbox.drain());
    this.every('send-notifications', () => this.notifications.deliverDue());
    this.every('send-webhooks', () => this.webhooks.deliverDue());
    this.every('prune-webhook-history', () => this.webhooks.prune());
    this.every('expire-unpaid-bookings', () => this.bookingService.expireUnpaid());
    this.every('approve-commissions', () => this.commissions.approveDue());
    this.every('sync-availability-sources', () => this.sources.syncAll());
    this.every('clean-up-old-rows', () => this.cleanup.run());
    // Reminders, review requests, monthly reports, billing warnings: each is sent once.
    this.every('retention-messages', () => this.retention.runDue());
    this.logger.log('background jobs started');
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.standby) clearTimeout(this.standby);
    this.stopJobs();
    // Closing the connection frees the lock for a standby worker.
    this.lock?.release(true);
    this.lock = null;
  }

  private stopJobs(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  private every(name: JobName, job: () => Promise<unknown>): void {
    let running = false;
    const tick = () => {
      if (running) return;
      running = true;
      job()
        .then(
          () => this.heartbeat(name, null),
          (error: unknown) => {
            const message = (error as Error).message;
            this.logger.error(`${name} failed: ${message}`);
            reportError(error, { job: name });
            return this.heartbeat(name, message, true);
          },
        )
        .catch((error: unknown) =>
          this.logger.warn(`${name}: heartbeat not saved: ${(error as Error).message}`),
        )
        .finally(() => {
          running = false;
        });
    };
    // Once at start-up, so the health check sees every job soon after a deploy.
    setImmediate(tick);
    const timer = setInterval(tick, JOBS[name]);
    timer.unref();
    this.timers.push(timer);
  }

  private async heartbeat(name: JobName, error: string | null, force = false): Promise<void> {
    const now = this.clock.now();
    const last = this.lastHeartbeat.get(name) ?? 0;
    if (!force && now.getTime() - last < HEARTBEAT_EVERY_MS) return;
    this.lastHeartbeat.set(name, now.getTime());
    await recordHeartbeat(this.db, name, now, error);
  }
}
