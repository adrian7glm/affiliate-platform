import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { periodKeyFor, periodRange, previousPeriod, tierProgress } from '@ap/commission';
import type { EventOfType } from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookings,
  commissionEntries,
  memberships,
  notifications,
  products,
  slots,
  tenantSubscriptions,
  tenants,
  tickets,
  users,
} from '@ap/db';
import { and, eq, gt, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { AnalyticsService } from '../analytics/analytics.service';
import { BookingService } from '../booking/booking.service';
import { Clock } from '../common/clock';
import type { Tenant } from '../common/tenants';
import { TenantsService } from '../common/tenants';
import { AffiliateEarningsService } from '../commissions/affiliate-earnings.service';
import { CommissionPlansService } from '../commissions/commission-plans.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx, type Tx } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import type { TemplateName, TemplateParams } from '../notifications/templates';
import { Outbox } from '../outbox/outbox';
import { type BillingState, SubscriptionsService } from '../platform/subscriptions.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Trial reminder: this long before the trial ends. */
const TRIAL_WARNING_MS = 3 * DAY_MS;
/** Departure reminder: at this local hour the evening before the trip. */
const REMINDER_HOUR = 18;
/** No reminder for a booking made this close to the reminder: its ticket just arrived. */
const REMINDER_FRESH_MS = 6 * HOUR_MS;
/** Review request: at this local hour the day after the trip, for up to two days. */
const REVIEW_HOUR = 10;
const REVIEW_WINDOW_MS = 2 * DAY_MS;
/** Tier nudge: in the last days of the month, to affiliates this close to the next level. */
const NUDGE_LAST_DAYS = 5;
const NUDGE_HOUR = 10;
const NUDGE_MAX_SALES = 3;
/** Monthly report: from this local hour on the 1st, for the first days of the month. */
const REPORT_HOUR = 8;
const REPORT_LAST_DAY = 3;
const REPORT_TOP_AFFILIATES = 3;

interface Recipient {
  to: string;
  locale: string;
}

/**
 * Messages nobody asked for, sent so that each side keeps coming back: customers are reminded of
 * their trip and asked for a review, affiliates hear about every sale, how close the next
 * commission level is and when they were paid, and operators get a monthly report and fair
 * warning before an unpaid subscription pauses their sales.
 *
 * Event-driven messages are queued in the transaction of the event. The scheduled ones are found
 * by `runDue`, which the worker calls every few minutes: every message has a dedupe key, so
 * running it often (or on two workers) never sends one twice.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger('Retention');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly notifications: NotificationsService,
    private readonly outbox: Outbox,
    private readonly earnings: AffiliateEarningsService,
    private readonly plans: CommissionPlansService,
    private readonly analytics: AnalyticsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly bookingService: BookingService,
  ) {}

  onModuleInit(): void {
    // Registered after the commission module's handler (this module imports it), so the
    // sale's commission entry already exists when the message is written.
    this.outbox.on('booking.confirmed', 'retention.affiliate-sale', (event, tx) =>
      this.affiliateSale(event, tx),
    );
    this.outbox.on('payout.paid', 'retention.payout-paid', (event, tx) =>
      this.payoutPaid(event, tx),
    );
  }

  /** Queues every scheduled message that is due. Returns how many were queued. */
  async runDue(): Promise<number> {
    let queued = 0;
    const steps: [string, () => Promise<number>][] = [
      ['billing', () => this.billingReminders()],
      ['trip reminders', () => this.tripReminders()],
      ['review requests', () => this.reviewRequests()],
      ['tier nudges', () => this.tierNudges()],
      ['monthly reports', () => this.monthlyReports()],
    ];
    for (const [name, step] of steps) {
      try {
        queued += await step();
      } catch (error) {
        // One failing step must not stop the others.
        this.logger.error(`${name} failed: ${(error as Error).message}`);
      }
    }
    return queued;
  }

  // ----------------------------------------------------------------------------------------------
  // Affiliates
  // ----------------------------------------------------------------------------------------------

  /** booking.confirmed: "you made a sale", with the commission and the way to the next level. */
  async affiliateSale(event: EventOfType<'booking.confirmed'>, tx: Tx): Promise<void> {
    if (!event.affiliateId) return;
    const tenant = await this.tenants.get(event.tenantId, tx);
    if (!tenant.notifyAffiliates) return;
    const recipient = await this.affiliateRecipient(tx, event.affiliateId, tenant);
    if (!recipient) return;
    const [entry] = await tx
      .select({ amountMinor: commissionEntries.amountMinor })
      .from(commissionEntries)
      .where(
        and(eq(commissionEntries.bookingId, event.bookingId), eq(commissionEntries.kind, 'sale')),
      );
    // No commission plan: the sale earned nothing, so there is nothing to celebrate.
    if (!entry) return;
    const [booking] = await tx
      .select({ startsAt: bookings.startsAt, seats: bookings.seats, product: products.name })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .where(eq(bookings.id, event.bookingId));
    if (!booking) return;

    const periodKey = periodKeyFor(new Date(event.paidAt), tenant.timezone);
    const sales = await this.earnings.paidSalesCount(event.affiliateId, tenant, periodKey, tx);
    const resolved = await this.plans.planFor(tx, event.affiliateId);
    const progress = resolved ? tierProgress(resolved.plan, sales) : null;
    const tier =
      resolved?.plan.kind === 'tiered' && progress ? resolved.plan.tiers[progress.tierIndex] : null;
    // This sale opened a higher level: the first sale counted at that level.
    const reached = tier && progress!.tierIndex > 0 && tier.fromSale === sales;

    await this.send(tx, recipient, 'affiliate_sale', `affiliate_sale:${event.bookingId}`, tenant, {
      tenantName: tenant.name,
      productName: booking.product,
      startsAt: booking.startsAt.toISOString(),
      timezone: tenant.timezone,
      seats: booking.seats,
      commissionMinor: entry.amountMinor,
      currency: event.currency,
      salesThisMonth: sales,
      reachedRateBps: reached ? tier.rateBps : null,
      salesToNextTier: progress?.salesToNextTier ?? null,
      nextRateBps: progress?.nextRateBps ?? null,
      url: `${this.config.WEB_URL}/a`,
    });
  }

  /** payout.paid: "the operator paid your commission". */
  async payoutPaid(event: EventOfType<'payout.paid'>, tx: Tx): Promise<void> {
    if (event.amountMinor <= 0) return;
    const tenant = await this.tenants.get(event.tenantId, tx);
    if (!tenant.notifyAffiliates) return;
    const recipient = await this.affiliateRecipient(tx, event.affiliateId, tenant);
    if (!recipient) return;
    await this.send(tx, recipient, 'payout_paid', `payout_paid:${event.payoutId}`, tenant, {
      tenantName: tenant.name,
      amountMinor: event.amountMinor,
      currency: event.currency,
      periodKey: event.periodKey,
      url: `${this.config.WEB_URL}/a/earnings`,
    });
  }

  /**
   * In the last days of the month, affiliates a few sales away from the next commission level
   * are told how close they are, before the count starts again from zero.
   */
  async tierNudges(): Promise<number> {
    const now = this.clock.now();
    let queued = 0;
    for (const tenant of await this.liveTenants()) {
      if (!tenant.notifyAffiliates) continue;
      const local = DateTime.fromJSDate(now, { zone: tenant.timezone });
      const daysLeft = (local.daysInMonth ?? 31) - local.day + 1;
      if (daysLeft > NUDGE_LAST_DAYS || local.hour < NUDGE_HOUR) continue;
      const periodKey = periodKeyFor(now, tenant.timezone);
      const resetsAt = periodRange(periodKey, tenant.timezone).end.toISOString();

      const sellers = await this.db
        .select({ id: affiliates.id })
        .from(affiliates)
        .where(
          and(
            eq(affiliates.tenantId, tenant.id),
            eq(affiliates.status, 'active'),
            eq(affiliates.notifySales, true),
            isNotNull(affiliates.userId),
          ),
        );
      const keyOf = (affiliateId: string) => `tier_nudge:${affiliateId}:${periodKey}`;
      const done = await this.sentKeys(sellers.map((s) => keyOf(s.id)));
      for (const seller of sellers) {
        if (done.has(keyOf(seller.id))) continue;
        const resolved = await this.plans.planFor(this.db, seller.id);
        if (resolved?.plan.kind !== 'tiered') continue;
        const sales = await this.earnings.paidSalesCount(seller.id, tenant, periodKey);
        const progress = tierProgress(resolved.plan, sales);
        if (
          progress.salesToNextTier === null ||
          progress.nextRateBps === null ||
          progress.salesToNextTier > NUDGE_MAX_SALES
        ) {
          continue;
        }
        const recipient = await this.affiliateRecipient(this.db, seller.id, tenant);
        if (!recipient) continue;
        const sent = await this.send(
          this.db,
          recipient,
          'affiliate_tier_nudge',
          keyOf(seller.id),
          tenant,
          {
            tenantName: tenant.name,
            salesToNextTier: progress.salesToNextTier,
            nextRateBps: progress.nextRateBps,
            resetsAt,
            timezone: tenant.timezone,
            url: `${this.config.WEB_URL}/a/qr`,
          },
        );
        if (sent) queued += 1;
      }
    }
    return queued;
  }

  /** An active affiliate who wants sale messages: their phone first (read at once), else email. */
  private async affiliateRecipient(
    db: DbOrTx,
    affiliateId: string,
    tenant: Tenant,
  ): Promise<Recipient | null> {
    const [row] = await db
      .select({
        status: affiliates.status,
        notifySales: affiliates.notifySales,
        phone: users.phone,
        email: users.email,
        locale: users.locale,
      })
      .from(affiliates)
      .innerJoin(users, eq(users.id, affiliates.userId))
      .where(eq(affiliates.id, affiliateId));
    if (!row || row.status !== 'active' || !row.notifySales) return null;
    const to = row.phone ?? row.email;
    return to ? { to, locale: row.locale ?? tenant.defaultLocale } : null;
  }

  // ----------------------------------------------------------------------------------------------
  // Customers
  // ----------------------------------------------------------------------------------------------

  /**
   * The evening before the trip, at 18:00 local time: the departure, the meeting point and the
   * ticket again. Fewer no-shows, fewer "where do we meet?" calls.
   */
  async tripReminders(): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .select({
        booking: bookings,
        product: products.name,
        meetingPoint: products.meetingPoint,
        tenant: tenants,
      })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          eq(tickets.status, 'valid'),
          eq(tenants.status, 'active'),
          eq(tenants.remindCustomers, true),
          gt(bookings.startsAt, new Date(now.getTime() + HOUR_MS)),
          lte(bookings.startsAt, new Date(now.getTime() + 36 * HOUR_MS)),
        ),
      );
    let queued = 0;
    for (const { booking, tenant, product, meetingPoint } of rows) {
      const sendAt = DateTime.fromJSDate(booking.startsAt, { zone: tenant.timezone })
        .minus({ days: 1 })
        .set({ hour: REMINDER_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();
      if (now < sendAt) continue;
      const bookedAt = booking.paidAt ?? booking.createdAt;
      if (bookedAt.getTime() > sendAt.getTime() - REMINDER_FRESH_MS) continue;
      const recipient = customerRecipient(booking);
      if (!recipient) continue;
      const sent = await this.send(
        this.db,
        recipient,
        'trip_reminder',
        `trip_reminder:${booking.id}`,
        tenant,
        {
          tenantName: tenant.name,
          productName: product,
          reference: booking.reference,
          startsAt: booking.startsAt.toISOString(),
          timezone: tenant.timezone,
          customerName: booking.customerName,
          meetingPoint,
          url: this.bookingService.ticketUrl(booking.id),
          contactPhone: tenant.contactPhone,
        },
      );
      if (sent) queued += 1;
    }
    return queued;
  }

  /**
   * The day after the trip, at 10:00 local time: a short thank-you with the operator's review
   * link (Google, TripAdvisor). Only for customers who boarded, when the operator scans tickets.
   */
  async reviewRequests(): Promise<number> {
    const now = this.clock.now();
    const anyBoarded = sql<boolean>`exists (
      select 1 from ${tickets} t2 join ${bookings} b2 on b2.id = t2.booking_id
      where b2.slot_id = ${bookings.slotId} and t2.status = 'checked_in')`;
    const rows = await this.db
      .select({
        booking: bookings,
        product: products.name,
        endsAt: slots.endsAt,
        ticketStatus: tickets.status,
        slotScanned: anyBoarded,
        tenant: tenants,
      })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          ne(tickets.status, 'void'),
          eq(tenants.status, 'active'),
          eq(tenants.askForReviews, true),
          isNotNull(tenants.reviewUrl),
          lte(slots.endsAt, now),
          gt(slots.endsAt, new Date(now.getTime() - 3 * DAY_MS)),
        ),
      );
    let queued = 0;
    for (const { booking, tenant, product, endsAt, ticketStatus, slotScanned } of rows) {
      // When the crew scans tickets, an unscanned ticket is a passenger who did not come.
      if (ticketStatus !== 'checked_in' && slotScanned) continue;
      const sendAt = DateTime.fromJSDate(endsAt, { zone: tenant.timezone })
        .plus({ days: 1 })
        .set({ hour: REVIEW_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();
      if (now < sendAt || now.getTime() > sendAt.getTime() + REVIEW_WINDOW_MS) continue;
      const recipient = customerRecipient(booking);
      if (!recipient) continue;
      const sent = await this.send(
        this.db,
        recipient,
        'review_request',
        `review_request:${booking.id}`,
        tenant,
        {
          tenantName: tenant.name,
          productName: product,
          customerName: booking.customerName,
          reviewUrl: tenant.reviewUrl!,
        },
      );
      if (sent) queued += 1;
    }
    return queued;
  }

  // ----------------------------------------------------------------------------------------------
  // Operators
  // ----------------------------------------------------------------------------------------------

  /**
   * The month that just ended, on the 1st at 08:00 local time: bookings, revenue, what the
   * affiliates brought and the commissions to pay. The reason to keep the subscription, in
   * numbers, every month.
   */
  async monthlyReports(): Promise<number> {
    const now = this.clock.now();
    let queued = 0;
    for (const tenant of await this.liveTenants()) {
      if (!tenant.monthlyReport) continue;
      const local = DateTime.fromJSDate(now, { zone: tenant.timezone });
      if (local.day > REPORT_LAST_DAY || (local.day === 1 && local.hour < REPORT_HOUR)) continue;
      const periodKey = previousPeriod(periodKeyFor(now, tenant.timezone));
      // An operator who joined this month has no month to report yet.
      if (tenant.createdAt >= periodRange(periodKey, tenant.timezone).end) continue;
      const subscription = await this.subscriptions.row(tenant.id);
      if (subscription?.status === 'canceled') continue;

      const owners = await this.ownerRecipients(tenant);
      const keyOf = (to: string) => `monthly_report:${tenant.id}:${periodKey}:${to}`;
      const done = await this.sentKeys(owners.map((o) => keyOf(o.to)));
      const pending = owners.filter((o) => !done.has(keyOf(o.to)));
      if (pending.length === 0) continue;

      const month = await this.analytics.month(tenant, periodKey);
      const params: TemplateParams['monthly_report'] = {
        tenantName: tenant.name,
        periodKey,
        previousPeriodKey: month.previous.periodKey,
        currency: tenant.currency,
        bookings: month.totals.bookings,
        revenueMinor: month.totals.revenueMinor,
        previousRevenueMinor: month.previous.revenueMinor,
        affiliateBookings: month.totals.affiliateBookings,
        affiliateRevenueMinor: month.totals.affiliateRevenueMinor,
        commissionMinor: month.commissions.totalMinor,
        payableMinor: month.commissions.payableMinor,
        activeAffiliates: month.affiliates.filter((a) => a.status === 'active').length,
        topAffiliates: month.affiliates
          .filter((a) => a.paidSales > 0)
          .slice(0, REPORT_TOP_AFFILIATES)
          .map((a) => ({ name: a.name, sales: a.paidSales })),
        url: `${this.config.WEB_URL}/o`,
        payoutsUrl: `${this.config.WEB_URL}/o/payouts`,
      };
      for (const owner of pending) {
        if (await this.send(this.db, owner, 'monthly_report', keyOf(owner.to), tenant, params)) {
          queued += 1;
        }
      }
    }
    return queued;
  }

  /**
   * Fair warning about the subscription: three days before the free trial ends, when it becomes
   * unpaid (with the date new bookings pause), and when they pause.
   */
  async billingReminders(): Promise<number> {
    const now = this.clock.now();
    const rows = await this.db
      .select({ sub: tenantSubscriptions, tenant: tenants })
      .from(tenantSubscriptions)
      .innerJoin(tenants, eq(tenants.id, tenantSubscriptions.tenantId))
      .where(eq(tenants.status, 'active'));
    let queued = 0;
    for (const { sub, tenant } of rows) {
      const url = `${this.config.WEB_URL}/o/billing`;
      const due = this.billingMessage(sub, tenant, now, url);
      if (!due) continue;
      for (const owner of await this.ownerRecipients(tenant)) {
        const key = `${due.key}:${owner.to}`;
        if (await this.send(this.db, owner, due.template, key, tenant, due.params)) queued += 1;
      }
    }
    return queued;
  }

  private billingMessage(
    sub: BillingState & { tenantId: string },
    tenant: Tenant,
    now: Date,
    url: string,
  ):
    | { template: 'trial_ending'; key: string; params: TemplateParams['trial_ending'] }
    | {
        template: 'subscription_unpaid';
        key: string;
        params: TemplateParams['subscription_unpaid'];
      }
    | { template: 'sales_paused'; key: string; params: TemplateParams['sales_paused'] }
    | null {
    const since = this.subscriptions.unpaidSince(sub);
    if (!since) {
      const endsAt = sub.status === 'trialing' ? sub.trialEndsAt : null;
      if (!endsAt || endsAt.getTime() - now.getTime() > TRIAL_WARNING_MS) return null;
      return {
        template: 'trial_ending',
        // A trial the platform owner extends gets its own reminder.
        key: `trial_ending:${sub.tenantId}:${endsAt.getTime()}`,
        params: {
          tenantName: tenant.name,
          endsAt: endsAt.toISOString(),
          timezone: tenant.timezone,
          url,
        },
      };
    }
    const pauseAt = this.subscriptions.salesPauseAt(sub)!;
    if (pauseAt <= now) {
      return {
        template: 'sales_paused',
        key: `sales_paused:${sub.tenantId}:${since.getTime()}`,
        params: { tenantName: tenant.name, url },
      };
    }
    const reasons = {
      trialing: 'trial',
      past_due: 'payment',
      active: 'expired',
      canceled: 'canceled',
    } as const;
    return {
      template: 'subscription_unpaid',
      key: `subscription_unpaid:${sub.tenantId}:${since.getTime()}`,
      params: {
        tenantName: tenant.name,
        reason: reasons[sub.status],
        pauseAt: pauseAt.toISOString(),
        timezone: tenant.timezone,
        url,
      },
    };
  }

  /** The operator's owners: email first (reports are long), else phone. */
  private async ownerRecipients(tenant: Tenant): Promise<Recipient[]> {
    const rows = await this.db
      .select({ email: users.email, phone: users.phone, locale: users.locale })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.role, 'owner')));
    return rows.flatMap((r) => {
      const to = r.email ?? r.phone;
      return to ? [{ to, locale: r.locale ?? tenant.defaultLocale }] : [];
    });
  }

  // ----------------------------------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------------------------------

  /** Operators that are not suspended. */
  private liveTenants(): Promise<Tenant[]> {
    return this.db.select().from(tenants).where(eq(tenants.status, 'active'));
  }

  /** Which of these dedupe keys were already queued, to skip expensive work for them. */
  private async sentKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await this.db
      .select({ key: notifications.dedupeKey })
      .from(notifications)
      .where(inArray(notifications.dedupeKey, keys));
    return new Set(rows.map((r) => r.key!));
  }

  /** Queues a message; false when it was already queued before (same dedupe key). */
  private send<T extends TemplateName>(
    db: DbOrTx,
    recipient: Recipient,
    template: T,
    dedupeKey: string,
    tenant: Tenant,
    params: TemplateParams[T],
  ): Promise<boolean> {
    return this.notifications.enqueue(db, {
      to: recipient.to,
      template,
      locale: recipient.locale,
      tenantId: tenant.id,
      dedupeKey,
      params,
    });
  }
}

/** A customer: email first (free, and room for the details), else the phone. */
function customerRecipient(booking: typeof bookings.$inferSelect): Recipient | null {
  const to = booking.customerEmail ?? booking.customerPhone;
  return to ? { to, locale: booking.customerLocale } : null;
}
