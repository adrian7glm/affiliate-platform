import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AdminSystemDto } from '@ap/contracts';
import { type Database, tenants } from '@ap/db';
import { inArray } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { reportError } from '../common/error-reporting';
import { NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { workerStatus } from '../jobs/jobs';
import { NotificationsService } from '../notifications/notifications.service';
import { type DeadEvent, Outbox } from '../outbox/outbox';

/**
 * The platform's own health for its admins: whether the background worker runs, and internal
 * events that stopped being retried. The admins get an email when an event is given up on,
 * because it can mean a missing commission or a ticket that was never sent.
 */
@Injectable()
export class SystemService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.outbox.onDeadEvent((event) => this.alert(event));
  }

  async overview(): Promise<AdminSystemDto> {
    const [worker, dead] = await Promise.all([
      workerStatus(this.db, this.clock.now()),
      this.outbox.dead(),
    ]);
    const tenantIds = [...new Set(dead.map((e) => e.tenantId).filter((id) => id !== null))];
    const names = tenantIds.length
      ? await this.db
          .select({ id: tenants.id, name: tenants.name })
          .from(tenants)
          .where(inArray(tenants.id, tenantIds))
      : [];
    return {
      worker,
      deadEvents: dead.map((e) => ({
        id: e.id,
        type: e.type,
        tenantId: e.tenantId,
        tenantName: names.find((n) => n.id === e.tenantId)?.name ?? null,
        attempts: e.attempts,
        lastError: e.lastError,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  async retry(id: number): Promise<AdminSystemDto> {
    if (!(await this.outbox.retry(id))) throw new NotFound('event');
    return this.overview();
  }

  private async alert(event: DeadEvent): Promise<void> {
    reportError(new Error(`internal event ${event.type} #${event.id} stopped: ${event.error}`), {
      eventId: event.id,
      eventType: event.type,
    });
    for (const admin of this.config.PLATFORM_ADMIN_EMAILS) {
      await this.notifications.enqueue(this.db, {
        to: admin,
        template: 'system_alert',
        // The platform's own language: the admins' area has no per-person language yet.
        locale: 'ro',
        dedupeKey: `dead_event:${event.id}:${this.clock.now().getTime()}:${admin}`,
        params: {
          eventId: event.id,
          eventType: event.type,
          error: event.error.slice(0, 500),
          url: `${this.config.WEB_URL}/admin/system`,
        },
      });
    }
  }
}
