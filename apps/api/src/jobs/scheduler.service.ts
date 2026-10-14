import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Database } from '@ap/db';
import { BookingService } from '../booking/booking.service';
import { Clock } from '../common/clock';
import { reportError } from '../common/error-reporting';
import { CommissionLedgerService } from '../commissions/ledger.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../integrations/webhooks.service';
import { Outbox } from '../outbox/outbox';
import { SourcesService } from '../sources/sources.service';
import { CleanupService } from './cleanup.service';
import { JOBS, type JobName, recordHeartbeat } from './jobs';

/** A job's heartbeat is written at most this often (the outbox runs every 3 seconds). */
const HEARTBEAT_EVERY_MS = 30_000;

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

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly bookingService: BookingService,
    private readonly commissions: CommissionLedgerService,
    private readonly sources: SourcesService,
    private readonly notifications: NotificationsService,
    private readonly cleanup: CleanupService,
    private readonly webhooks: WebhooksService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORKER_ENABLED) return;
    this.every('outbox', () => this.outbox.drain());
    this.every('send-notifications', () => this.notifications.deliverDue());
    this.every('send-webhooks', () => this.webhooks.deliverDue());
    this.every('prune-webhook-history', () => this.webhooks.prune());
    this.every('expire-unpaid-bookings', () => this.bookingService.expireUnpaid());
    this.every('approve-commissions', () => this.commissions.approveDue());
    this.every('sync-availability-sources', () => this.sources.syncAll());
    this.every('clean-up-old-rows', () => this.cleanup.run());
    this.logger.log('background jobs started');
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
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
