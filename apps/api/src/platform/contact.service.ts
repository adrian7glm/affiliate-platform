import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ContactRequestBody, ContactRequestDto } from '@ap/contracts';
import { type Database, contactRequests } from '@ap/db';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Messages a person may send from one address per hour, so a script cannot flood the inbox. */
const MAX_PER_HOUR = 3;

/** The public contact page: demo requests and questions from operators to the platform owner. */
@Injectable()
export class ContactService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(body: ContactRequestBody): Promise<void> {
    // Filled in only by bots: accept quietly, keep nothing.
    if (body.website) return;
    const now = this.clock.now();
    const [recent] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactRequests)
      .where(
        and(
          eq(contactRequests.email, body.email),
          gte(contactRequests.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.count ?? 0) >= MAX_PER_HOUR) {
      throw new DomainError('errors.contact.tooMany', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(contactRequests)
        .values({
          topic: body.topic,
          name: body.name,
          email: body.email,
          phone: body.phone ?? null,
          company: body.company || null,
          message: body.message,
          locale: body.locale?.slice(0, 20) || 'en',
          createdAt: now,
        })
        .returning({ id: contactRequests.id });
      for (const admin of this.config.PLATFORM_ADMIN_EMAILS) {
        await this.notifications.enqueue(tx, {
          to: admin,
          template: 'contact_request',
          // The platform's own language: the admins' area has no per-person language yet.
          locale: 'ro',
          dedupeKey: `contact_request:${created!.id}:${admin}`,
          params: {
            topic: body.topic,
            name: body.name,
            email: body.email,
            phone: body.phone ?? null,
            company: body.company || null,
            message: body.message,
            url: `${this.config.WEB_URL}/admin/contact`,
          },
        });
      }
    });
  }

  /** Open requests first (oldest first, so nobody waits), then the answered ones. */
  async list(limit = 200): Promise<ContactRequestDto[]> {
    const rows = await this.db
      .select()
      .from(contactRequests)
      .orderBy(
        sql`${contactRequests.handledAt} is not null`,
        asc(
          sql`case when ${contactRequests.handledAt} is null then ${contactRequests.createdAt} end`,
        ),
        desc(contactRequests.createdAt),
      )
      .limit(limit);
    return rows.map(toDto);
  }

  async setHandled(id: string, handled: boolean): Promise<ContactRequestDto> {
    const [row] = await this.db
      .update(contactRequests)
      .set({ handledAt: handled ? this.clock.now() : null })
      .where(eq(contactRequests.id, id))
      .returning();
    if (!row) throw new NotFound('contactRequest');
    return toDto(row);
  }
}

function toDto(row: typeof contactRequests.$inferSelect): ContactRequestDto {
  return {
    id: row.id,
    topic: row.topic,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    message: row.message,
    locale: row.locale,
    handledAt: row.handledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
