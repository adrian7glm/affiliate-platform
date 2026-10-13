import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CheckInResultDto, TicketDto } from '@ap/contracts';
import {
  type Database,
  bookingItems,
  bookings,
  products,
  slots,
  tenants,
  tickets,
  users,
} from '@ap/db';
import { and, eq } from 'drizzle-orm';
import { icsFile } from '../common/calendar';
import { Clock } from '../common/clock';
import { TicketSigner, checkTicketLinkKey, ticketLinkKey } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import type { Tenant } from '../common/tenants';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { I18nService } from '../i18n/i18n.service';
import { NotificationsService, mask } from '../notifications/notifications.service';
import { ticketCalendarEvent, ticketCalendarFilename } from '../notifications/ticket-calendar';
import { renderTicketPdf, ticketPdfFilename } from '../notifications/ticket-pdf';
import { Outbox } from '../outbox/outbox';

/** What the customer is told when the operator cancels their trip (bad weather...). */
export interface CancellationNotice {
  reason: 'weather' | 'other';
  message?: string | null;
}

@Injectable()
export class TicketsService {
  readonly signer: TicketSigner;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly notifications: NotificationsService,
    private readonly i18n: I18nService,
  ) {
    this.signer = new TicketSigner(config.APP_SECRET);
  }

  /** Creates the booking's ticket once and sends it to the customer. Idempotent. */
  async issue(tx: DbOrTx, bookingId: string, tenantId: string): Promise<void> {
    const [ticket] = await tx
      .insert(tickets)
      .values({ tenantId, bookingId })
      .onConflictDoNothing()
      .returning({ id: tickets.id });
    if (!ticket) return;
    const [row] = await tx
      .select({
        booking: bookings,
        productName: products.name,
        meetingPoint: products.meetingPoint,
        endsAt: slots.endsAt,
        tenant: tenants,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .where(eq(bookings.id, bookingId));
    if (!row) return;
    const { booking, tenant } = row;
    const items = await tx
      .select({ label: bookingItems.label, quantity: bookingItems.quantity })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));
    // Email first: it carries the QR code itself and costs nothing.
    const contact = booking.customerEmail ?? booking.customerPhone;
    if (!contact) return;
    await this.notifications.enqueue(tx, {
      to: contact,
      template: 'ticket',
      locale: booking.customerLocale,
      tenantId,
      dedupeKey: `ticket:${bookingId}`,
      params: {
        tenantName: tenant.name,
        productName: row.productName,
        reference: booking.reference,
        startsAt: booking.startsAt.toISOString(),
        timezone: tenant.timezone,
        customerName: booking.customerName,
        meetingPoint: row.meetingPoint,
        seats: booking.seats,
        url: this.customerUrl(bookingId, booking.customerLocale),
        qrToken: this.qrToken(ticket.id, booking),
        amountDueOnSiteMinor:
          booking.paymentMode === 'on_site' && !booking.paidAt ? booking.totalMinor : 0,
        currency: booking.currency,
        items,
        brandColor: tenant.branding.primaryColor ?? null,
        endsAt: row.endsAt.toISOString(),
      },
    });
  }

  /** Tells the customer that a confirmed booking was cancelled, and whether it was refunded. */
  async notifyCancelled(
    tx: DbOrTx,
    tenant: Tenant,
    booking: typeof bookings.$inferSelect,
    refunded: boolean,
    notice: CancellationNotice | null = null,
  ): Promise<void> {
    const contact = booking.customerEmail ?? booking.customerPhone;
    if (!contact) return;
    const [product] = await tx
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, booking.productId));
    await this.notifications.enqueue(tx, {
      to: contact,
      template: 'booking_cancelled',
      locale: booking.customerLocale,
      tenantId: tenant.id,
      dedupeKey: `booking_cancelled:${booking.id}`,
      params: {
        tenantName: tenant.name,
        productName: product?.name ?? '',
        reference: booking.reference,
        startsAt: booking.startsAt.toISOString(),
        timezone: tenant.timezone,
        refunded,
        reason: notice?.reason ?? null,
        message: notice?.message ?? null,
      },
    });
  }

  /** The ticket page link sent to the customer, in their language. */
  customerUrl(bookingId: string, locale: string): string {
    const key = ticketLinkKey(this.config.APP_SECRET, bookingId);
    return `${this.config.WEB_URL}/t/${bookingId}?k=${key}&lang=${this.i18n.pick(locale, 'en')}`;
  }

  private qrToken(
    ticketId: string,
    booking: Pick<typeof bookings.$inferSelect, 'tenantId' | 'reference' | 'startsAt' | 'seats'>,
  ): string {
    return this.signer.sign({
      tid: ticketId,
      ten: booking.tenantId,
      ref: booking.reference,
      at: booking.startsAt.toISOString(),
      seats: booking.seats,
    });
  }

  async void(tx: DbOrTx, bookingId: string): Promise<void> {
    await tx.update(tickets).set({ status: 'void' }).where(eq(tickets.bookingId, bookingId));
  }

  /** The customer's ticket page, opened with the key from their ticket link. */
  async view(bookingId: string, key: string): Promise<TicketDto> {
    if (!checkTicketLinkKey(this.config.APP_SECRET, bookingId, key)) throw new NotFound('ticket');
    return this.ticketDto(bookingId);
  }

  /**
   * The ticket as a PDF to keep on the phone. Only for tickets that can be boarded with (valid,
   * or already used, which prints as used); the language defaults to the customer's.
   */
  async pdf(
    bookingId: string,
    key: string,
    lang: string | null,
  ): Promise<{ filename: string; content: Buffer }> {
    const ticket = await this.view(bookingId, key);
    if (!ticket.qrToken) {
      throw new DomainError('errors.ticket.noPdf', HttpStatus.CONFLICT);
    }
    const [row] = await this.db
      .select({ locale: bookings.customerLocale, branding: tenants.branding })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(eq(bookings.id, bookingId));
    const language = this.i18n.pick(lang ?? row?.locale, 'en');
    const content = await renderTicketPdf(
      {
        tenantName: ticket.tenantName,
        productName: ticket.productName,
        reference: ticket.bookingReference,
        startsAt: ticket.startsAt,
        timezone: ticket.timezone,
        customerName: ticket.customerName,
        meetingPoint: ticket.meetingPoint,
        seats: ticket.seats,
        items: ticket.items,
        qrToken: ticket.qrToken,
        amountDueOnSiteMinor: ticket.amountDueOnSiteMinor,
        currency: ticket.currency,
        url: this.customerUrl(bookingId, language),
        used: ticket.status === 'checked_in',
        brandColor: row?.branding.primaryColor ?? null,
      },
      this.i18n.translator(language),
    );
    return {
      filename: ticketPdfFilename(ticket.bookingReference, this.i18n.translator(language)),
      content,
    };
  }

  /** The trip as a calendar event (.ics), for valid and used tickets. */
  async calendar(
    bookingId: string,
    key: string,
    lang: string | null,
  ): Promise<{ filename: string; content: string }> {
    const ticket = await this.view(bookingId, key);
    if (!ticket.qrToken) throw new DomainError('errors.ticket.noCalendar', HttpStatus.CONFLICT);
    const [row] = await this.db
      .select({ locale: bookings.customerLocale })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const language = this.i18n.pick(lang ?? row?.locale, 'en');
    const event = ticketCalendarEvent(
      {
        tenantName: ticket.tenantName,
        productName: ticket.productName,
        reference: ticket.bookingReference,
        startsAt: ticket.startsAt,
        endsAt: ticket.endsAt,
        meetingPoint: ticket.meetingPoint,
        url: this.customerUrl(bookingId, language),
      },
      this.i18n.translator(language),
    );
    return {
      filename: ticketCalendarFilename(ticket.bookingReference),
      content: icsFile(event, this.clock.now()),
    };
  }

  private async ticketDto(bookingId: string): Promise<TicketDto> {
    const [row] = await this.db
      .select({
        booking: bookings,
        product: products,
        tenantName: tenants.name,
        timezone: tenants.timezone,
        branding: tenants.branding,
        cancellationPolicy: tenants.cancellationPolicy,
        contactEmail: tenants.contactEmail,
        contactPhone: tenants.contactPhone,
        endsAt: slots.endsAt,
        ticket: tickets,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .innerJoin(slots, eq(slots.id, bookings.slotId))
      .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId));
    if (!row) throw new NotFound('ticket');
    const items = await this.db
      .select({ label: bookingItems.label, quantity: bookingItems.quantity })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));
    const { booking, ticket } = row;

    // Paid, but the ticket is issued a moment later (outbox): still "confirming the payment", so
    // the customer's page keeps refreshing instead of showing a cancelled ticket.
    const issuing = booking.status === 'confirmed' && !ticket;
    const status: TicketDto['status'] =
      booking.status === 'pending_payment' || issuing
        ? 'pending_payment'
        : !ticket || booking.status !== 'confirmed'
          ? 'void'
          : ticket.status;
    const qrToken =
      ticket && (status === 'valid' || status === 'checked_in')
        ? this.qrToken(ticket.id, booking)
        : null;
    const dueOnSite = booking.paymentMode === 'on_site' && !booking.paidAt ? booking.totalMinor : 0;
    return {
      bookingReference: booking.reference,
      status,
      productName: row.product.name,
      tenantName: row.tenantName,
      timezone: row.timezone,
      branding: row.branding,
      startsAt: booking.startsAt.toISOString(),
      meetingPoint: row.product.meetingPoint,
      seats: booking.seats,
      items,
      customerName: booking.customerName,
      qrToken,
      paymentMode: booking.paymentMode,
      amountDueOnSiteMinor: dueOnSite,
      currency: booking.currency,
      endsAt: row.endsAt.toISOString(),
      cancellationPolicy: row.cancellationPolicy,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
    };
  }

  /** Boarding scan. Also the moment a pay-on-site booking counts as paid. */
  async checkIn(
    tenantId: string,
    token: string,
    userId: string,
    lang = 'en',
  ): Promise<CheckInResultDto> {
    const payload = this.signer.verify(token);
    if (!payload || payload.ten !== tenantId) {
      return {
        result: 'not_valid',
        message: this.i18n.translate(lang, 'errors.checkIn.otherOperator'),
        ticket: null,
        collectMinor: 0,
        checkedInAt: null,
        checkedInBy: null,
      };
    }
    const now = this.clock.now();
    const outcome = await this.db.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, payload.tid), eq(tickets.tenantId, tenantId)))
        .for('update');
      if (!ticket) return { result: 'not_valid' as const, bookingId: null, collectMinor: 0 };
      const firstScan = {
        checkedInAt: ticket.checkedInAt,
        checkedInByUserId: ticket.checkedInByUserId,
      };
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, ticket.bookingId))
        .for('update');
      if (!booking || ticket.status === 'void' || booking.status !== 'confirmed') {
        return { result: 'not_valid' as const, bookingId: ticket.bookingId, collectMinor: 0 };
      }
      if (ticket.status === 'checked_in') {
        return {
          result: 'already_checked_in' as const,
          bookingId: booking.id,
          collectMinor: 0,
          ...firstScan,
        };
      }

      await tx
        .update(tickets)
        .set({ status: 'checked_in', checkedInAt: now, checkedInByUserId: userId })
        .where(eq(tickets.id, ticket.id));
      let collectMinor = 0;
      if (booking.paymentMode === 'on_site' && !booking.paidAt) {
        collectMinor = booking.totalMinor;
        await tx.update(bookings).set({ paidAt: now }).where(eq(bookings.id, booking.id));
        await this.outbox.publish(tx, {
          type: 'booking.confirmed',
          tenantId,
          bookingId: booking.id,
          affiliateId: booking.affiliateId,
          paidAt: now.toISOString(),
          totalMinor: booking.totalMinor,
          taxMinor: booking.taxMinor,
          currency: booking.currency,
        });
      }
      await this.outbox.publish(tx, {
        type: 'ticket.checked_in',
        tenantId,
        ticketId: ticket.id,
        bookingId: booking.id,
        checkedInAt: now.toISOString(),
      });
      return {
        result: 'checked_in' as const,
        bookingId: booking.id,
        collectMinor,
        checkedInAt: now,
        checkedInByUserId: userId,
      };
    });

    const ticket = outcome.bookingId ? await this.ticketDto(outcome.bookingId) : null;
    const scan = 'checkedInAt' in outcome ? outcome : null;
    const messages = {
      checked_in: 'errors.checkIn.checkedIn',
      already_checked_in: 'errors.checkIn.alreadyCheckedIn',
      not_valid: 'errors.checkIn.notValid',
    };
    return {
      result: outcome.result,
      message: this.i18n.translate(lang, messages[outcome.result]),
      ticket,
      collectMinor: outcome.collectMinor,
      checkedInAt: scan?.checkedInAt?.toISOString() ?? null,
      checkedInBy: scan?.checkedInByUserId ? await this.personLabel(scan.checkedInByUserId) : null,
    };
  }

  /** A name to show on the scanner for whoever scanned a ticket. */
  private async personLabel(userId: string): Promise<string | null> {
    const [user] = await this.db
      .select({ name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return null;
    const contact = user.email ?? user.phone;
    return user.name ?? (contact ? mask(contact) : null);
  }
}
