import { Inject, Injectable } from '@nestjs/common';
import type { CheckInResultDto, TicketDto } from '@ap/contracts';
import { type Database, bookingItems, bookings, products, tenants, tickets } from '@ap/db';
import { and, eq } from 'drizzle-orm';
import { Clock } from '../common/clock';
import { TicketSigner, checkTicketLinkKey, ticketLinkKey } from '../common/crypto';
import { NotFound } from '../common/errors';
import { Notifier } from '../common/notifier';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { Outbox } from '../outbox/outbox';

@Injectable()
export class TicketsService {
  readonly signer: TicketSigner;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly outbox: Outbox,
    private readonly notifier: Notifier,
  ) {
    this.signer = new TicketSigner(config.APP_SECRET);
  }

  /** Creates the booking's ticket once and sends its link to the customer. Idempotent. */
  async issue(tx: DbOrTx, bookingId: string, tenantId: string): Promise<void> {
    const [ticket] = await tx
      .insert(tickets)
      .values({ tenantId, bookingId })
      .onConflictDoNothing()
      .returning({ id: tickets.id });
    if (!ticket) return;
    const [row] = await tx
      .select({ booking: bookings, productName: products.name })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .where(eq(bookings.id, bookingId));
    const contact = row?.booking.customerEmail ?? row?.booking.customerPhone;
    if (row && contact) {
      const key = ticketLinkKey(this.config.APP_SECRET, bookingId);
      await this.notifier.send({
        to: contact,
        subject: `${row.productName}: biletul tău ${row.booking.reference}`,
        text: `Biletul tău pentru ${row.productName}: ${this.config.WEB_URL}/t/${bookingId}?k=${key}`,
      });
    }
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
      .select({ booking: bookings, product: products, tenantName: tenants.name, ticket: tickets })
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
        ? this.signer.sign({
            tid: ticket.id,
            ten: booking.tenantId,
            ref: booking.reference,
            at: booking.startsAt.toISOString(),
            seats: booking.seats,
          })
        : null;
    const dueOnSite = booking.paymentMode === 'on_site' && !booking.paidAt ? booking.totalMinor : 0;
    return {
      bookingReference: booking.reference,
      status,
      productName: row.product.name,
      tenantName: row.tenantName,
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
      };
    }
    const now = this.clock.now();
    const outcome = await this.db.transaction(async (tx) => {
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, payload.tid), eq(tickets.tenantId, tenantId)))
        .for('update');
      if (!ticket) return { result: 'not_valid' as const, bookingId: null };
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, ticket.bookingId))
        .for('update');
      if (!booking || ticket.status === 'void' || booking.status !== 'confirmed') {
        return { result: 'not_valid' as const, bookingId: ticket.bookingId };
      }
      if (ticket.status === 'checked_in')
        return { result: 'already_checked_in' as const, bookingId: booking.id };

      await tx
        .update(tickets)
        .set({ status: 'checked_in', checkedInAt: now, checkedInByUserId: userId })
        .where(eq(tickets.id, ticket.id));
      if (booking.paymentMode === 'on_site' && !booking.paidAt) {
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
      return { result: 'checked_in' as const, bookingId: booking.id };
    });

    const ticket = outcome.bookingId ? await this.ticketDto(outcome.bookingId) : null;
    const messages = {
      checked_in: 'Welcome aboard.',
      already_checked_in: 'This ticket was already scanned.',
      not_valid: 'This ticket is not valid (cancelled, refunded or unpaid).',
    };
    return { result: outcome.result, message: messages[outcome.result], ticket };
  }
}
