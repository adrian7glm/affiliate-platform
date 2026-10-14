import { Inject, Injectable } from '@nestjs/common';
import { type Database, bookings, products, slots, tenants } from '@ap/db';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { type CalendarEvent, icsCalendar } from '../common/calendar';
import { Clock } from '../common/clock';
import { randomToken } from '../common/crypto';
import { NotFound } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { I18nService } from '../i18n/i18n.service';

/** Departures this far back stay in the calendar, so last week's trips can still be looked up. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
/** Calendar apps are asked to fetch the feed again this often (Google decides on its own). */
const REFRESH_MINUTES = 30;

/**
 * Every departure of the operator as a calendar feed: subscribed once in Google Calendar,
 * Outlook or a phone, it shows the trips with how many seats are booked. The address carries a
 * secret token instead of a login, as calendar apps cannot sign in; it holds no customer names.
 */
@Injectable()
export class CalendarFeedService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly i18n: I18nService,
  ) {}

  /** The feed's token, created the first time someone asks for it. */
  async token(tenantId: string): Promise<string> {
    await this.db
      .update(tenants)
      .set({ calendarFeedToken: randomToken(24) })
      .where(and(eq(tenants.id, tenantId), isNull(tenants.calendarFeedToken)));
    const [tenant] = await this.db
      .select({ token: tenants.calendarFeedToken })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!tenant?.token) throw new NotFound('operator');
    return tenant.token;
  }

  /** A new address; calendars subscribed to the old one stop updating. */
  async reset(tenantId: string): Promise<string> {
    const token = randomToken(24);
    await this.db.update(tenants).set({ calendarFeedToken: token }).where(eq(tenants.id, tenantId));
    return token;
  }

  async ics(token: string, lang: string | null): Promise<string> {
    const [tenant] = token
      ? await this.db.select().from(tenants).where(eq(tenants.calendarFeedToken, token))
      : [];
    if (!tenant || tenant.status === 'suspended') throw new NotFound('calendar');
    const t = this.i18n.translator(this.i18n.pick(lang ?? tenant.defaultLocale, 'en'));

    const now = this.clock.now();
    const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
    const to = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);
    const rows = await this.db
      .select({ slot: slots, productName: products.name, meetingPoint: products.meetingPoint })
      .from(slots)
      .innerJoin(products, eq(products.id, slots.productId))
      .where(and(eq(slots.tenantId, tenant.id), gte(slots.startsAt, from), lt(slots.startsAt, to)))
      .orderBy(asc(slots.startsAt))
      .limit(5000);
    const booked = rows.length
      ? await this.db
          .select({
            slotId: bookings.slotId,
            seats: sql<number>`coalesce(sum(${bookings.seats}), 0)::int`,
            count: sql<number>`count(*)::int`,
          })
          .from(bookings)
          .where(
            and(
              inArray(
                bookings.slotId,
                rows.map((r) => r.slot.id),
              ),
              eq(bookings.status, 'confirmed'),
            ),
          )
          .groupBy(bookings.slotId)
      : [];
    const bySlot = new Map(booked.map((b) => [b.slotId, b]));
    const url = `${this.config.WEB_URL}/o/bookings`;

    const events: CalendarEvent[] = rows.flatMap(({ slot, productName, meetingPoint }) => {
      const taken = bySlot.get(slot.id);
      const seats = taken?.seats ?? 0;
      // Closed with nobody on it: not offered and not running (or called off), so left out.
      // Closed with passengers: sales stopped, but the trip still runs.
      if (slot.closed && seats === 0) return [];
      const vars = { trip: productName, booked: seats, capacity: slot.capacity };
      return [
        {
          uid: `${slot.id}@departures`,
          title: t.t('integrations.feed.title', vars),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          location: meetingPoint,
          description: t.t('integrations.feed.description', {
            bookings: taken?.count ?? 0,
            booked: seats,
            capacity: slot.capacity,
            free: Math.max(0, slot.capacity - seats),
            url,
          }),
          url,
        },
      ];
    });
    return icsCalendar(events, now, {
      name: `${tenant.name} · ${t.t('integrations.feed.name')}`,
      refreshMinutes: REFRESH_MINUTES,
    });
  }
}
