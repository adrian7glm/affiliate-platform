import { Inject, Injectable } from '@nestjs/common';
import type { CheckInResultDto, TicketDto } from '@ap/contracts';
import { type Database, bookingItems, bookings, products, tenants, tickets } from '@ap/db';
import { and, eq } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { TicketSigner, checkTicketLinkKey, ticketLinkKey } from '../common/crypto';
import { NotFound } from '../common/errors';
import type { Tenant } from '../common/tenants';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { messageLang } from '../notifications/templates';
import { Outbox } from '../outbox/outbox';

@Injectable()
export class TicketsService {
  readonly signer: TicketSigner;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly notifications: NotificationsService,
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
        tenant: tenants,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(eq(bookings.id, bookingId));
    if (!row) return;
    const { booking, tenant } = row;
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
      },
    });
  }

  /** Tells the customer that a confirmed booking was cancelled, and whether it was refunded. */
  async notifyCancelled(
    tx: DbOrTx,
    tenant: Tenant,
    booking: typeof bookings.$inferSelect,
    refunded: boolean,
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
      },
    });
  }

  /** The ticket page link sent to the customer, in their language. */
  customerUrl(bookingId: string, locale: string): string {
    const key = ticketLinkKey(this.config.APP_SECRET, bookingId);
    return `${this.config.WEB_URL}/t/${bookingId}?k=${key}&lang=${messageLang(locale)}`;
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

  private async ticketDto(bookingId: string): Promise<TicketDto> {
    const [row] = await this.db
      .select({
        booking: bookings,
        product: products,
        tenantName: tenants.name,
        timezone: tenants.timezone,
        ticket: tickets,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId));
    if (!row) throw new NotFound('ticket');
    const items = await this.db
      .select({ label: bookingItems.label, quantity: bookingItems.quantity })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId));
    const { booking, ticket } = row;

    const status: TicketDto['status'] =
      booking.status === 'pending_payment'
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
      startsAt: booking.startsAt.toISOString(),
      meetingPoint: row.product.meetingPoint,
      seats: booking.seats,
      items,
      customerName: booking.customerName,
      qrToken,
      paymentMode: booking.paymentMode,
      amountDueOnSiteMinor: dueOnSite,
      currency: booking.currency,
    };
  }

  /** Boarding scan. Also the moment a pay-on-site booking counts as paid. */
  async checkIn(tenantId: string, token: string, userId: string): Promise<CheckInResultDto> {
    const payload = this.signer.verify(token);
    if (!payload || payload.ten !== tenantId) {
      return {
        result: 'not_valid',
        message: 'This QR code is not a ticket of this operator.',
        ticket: null,
        collectMinor: 0,
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
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, ticket.bookingId))
        .for('update');
      if (!booking || ticket.status === 'void' || booking.status !== 'confirmed') {
        return { result: 'not_valid' as const, bookingId: ticket.bookingId, collectMinor: 0 };
      }
      if (ticket.status === 'checked_in')
        return { result: 'already_checked_in' as const, bookingId: booking.id, collectMinor: 0 };

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
      return { result: 'checked_in' as const, bookingId: booking.id, collectMinor };
    });

    const ticket = outcome.bookingId ? await this.ticketDto(outcome.bookingId) : null;
    const messages = {
      checked_in: 'Welcome aboard.',
      already_checked_in: 'This ticket was already scanned.',
      not_valid: 'This ticket is not valid (cancelled, refunded or unpaid).',
    };
    return {
      result: outcome.result,
      message: messages[outcome.result],
      ticket,
      collectMinor: outcome.collectMinor,
    };
  }
}
