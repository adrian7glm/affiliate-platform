import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { BookingService } from '../booking/booking.service';
import { CommissionsService } from '../commissions/commissions.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { Outbox } from '../outbox/outbox';

/**
 * Background work, run in the API process when WORKER_ENABLED=true. The same jobs can move to a
 * dedicated worker process later without changes: they only use the services below.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Scheduler');
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly outbox: Outbox,
    private readonly bookingService: BookingService,
    private readonly commissions: CommissionsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORKER_ENABLED) return;
    this.every('outbox', 3_000, () => this.outbox.drain());
    this.every('expire-unpaid-bookings', 60_000, () => this.bookingService.expireUnpaid());
    this.every('approve-commissions', 10 * 60_000, () => this.commissions.approveDue());
    this.logger.log('background jobs started');
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearInterval(timer);
  }

  private every(name: string, ms: number, job: () => Promise<unknown>): void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      job()
        .catch((error: unknown) => this.logger.error(`${name} failed: ${(error as Error).message}`))
        .finally(() => {
          running = false;
        });
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }
}
