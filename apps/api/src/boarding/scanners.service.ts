import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AddScannerBody, ScannerAccountDto, ScannerContextDto } from '@ap/contracts';
import { type Database, memberships, tickets, users } from '@ap/db';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock';
import { DomainError, NotFound } from '../common/errors';
import { col } from '../common/sql';
import { TenantsService } from '../common/tenants';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { IdentityService, isEmail } from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Boarding staff accounts: people at the departure point who only scan tickets. They sign in
 * like everyone else (one-time code) and get the `scanner` role in one operator.
 */
@Injectable()
export class ScannersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identity: IdentityService,
    private readonly notifications: NotificationsService,
    private readonly tenants: TenantsService,
    private readonly clock: Clock,
  ) {}

  async list(tenantId: string): Promise<ScannerAccountDto[]> {
    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        createdAt: memberships.createdAt,
        lastScanAt: sql<Date | null>`(select max(${col(tickets.checkedInAt)}) from ${tickets}
          where ${col(tickets.tenantId)} = ${tenantId} and ${col(tickets.checkedInByUserId)} = ${col(users.id)})`,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'scanner')))
      .orderBy(asc(users.name), asc(memberships.createdAt));
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastScanAt: r.lastScanAt ? new Date(r.lastScanAt).toISOString() : null,
    }));
  }

  async add(tenantId: string, body: AddScannerBody): Promise<ScannerAccountDto> {
    const tenant = await this.tenants.get(tenantId);
    const userId = await this.db.transaction(async (tx) => {
      const id = await this.identity.findOrCreateUser(tx, body.destination, body.name);
      // Keep a name someone already chose for themselves; fill it in when there is none.
      await tx
        .update(users)
        .set({ name: body.name })
        .where(and(eq(users.id, id), sql`${users.name} is null`));
      const [created] = await tx
        .insert(memberships)
        .values({ userId: id, tenantId, role: 'scanner' })
        .onConflictDoNothing()
        .returning({ id: memberships.id });
      if (!created) {
        throw new DomainError('this person already has a scanner account', HttpStatus.CONFLICT);
      }
      await this.notifications.enqueue(tx, {
        to: body.destination,
        template: 'scanner_invite',
        locale: tenant.defaultLocale,
        tenantId,
        params: {
          tenantName: tenant.name,
          name: body.name,
          url: `${this.config.WEB_URL}/login?next=%2Fs&${isEmail(body.destination) ? 'email' : 'phone'}=${encodeURIComponent(body.destination)}`,
        },
      });
      return id;
    });
    const account = (await this.list(tenantId)).find((a) => a.userId === userId);
    if (!account) throw new NotFound('scanner account');
    return account;
  }

  /** Takes away scanning access. Tickets the person already scanned keep their name. */
  async remove(tenantId: string, userId: string): Promise<void> {
    const deleted = await this.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.role, 'scanner'),
        ),
      )
      .returning({ id: memberships.id });
    if (deleted.length === 0) throw new NotFound('scanner account');
  }

  /** What the scanner screen needs: the operator's name, time zone and today's count. */
  async context(tenantId: string, userId: string): Promise<ScannerContextDto> {
    const tenant = await this.tenants.get(tenantId);
    const since = DateTime.fromJSDate(this.clock.now())
      .setZone(tenant.timezone)
      .startOf('day')
      .toJSDate();
    const [mine] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, tenantId),
          eq(tickets.checkedInByUserId, userId),
          gte(tickets.checkedInAt, since),
        ),
      );
    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        currency: tenant.currency,
        timezone: tenant.timezone,
        logoUrl: tenant.branding.logoUrl ?? null,
      },
      scannedTodayByMe: mine?.count ?? 0,
    };
  }
}
