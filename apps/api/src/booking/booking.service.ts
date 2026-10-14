import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { applyRate } from '@ap/commission';
import type {
  AssistedBookingBody,
  BookingChannel,
  BookingDto,
  CancelDeparturesBody,
  CancelDeparturesResultDto,
  CheckoutResultDto,
  PublicCheckoutBody,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  auditLog,
  bookingItems,
  bookings,
  holds,
  payments,
  products,
  slots,
} from '@ap/db';
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { AvailabilityService } from '../catalog/availability.service';
import { CatalogService, toOperatorSlotDto } from '../catalog/catalog.service';
import { Clock } from '../common/clock';
import { randomCode, ticketLinkKey } from '../common/crypto';
import { DomainError, NotFound } from '../common/errors';
import { type Tenant, TenantsService } from '../common/tenants';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB, type DbOrTx } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { Outbox } from '../outbox/outbox';
import { PaymentsGateway } from '../payments/gateway';
import { SourcesService } from '../sources/sources.service';
import { type Attribution, LinksService } from '../tracking/links.service';
import { type CancellationNotice, TicketsService } from './tickets.service';

export type Booking = typeof bookings.$inferSelect;

interface CreateInput {
  tenant: Tenant;
  slotId: string;
  items: { priceId: string; quantity: number }[];
  customer: PublicCheckoutBody['customer'];
  channel: BookingChannel;
  attribution: Attribution | null;
  createdByUserId: string | null;
  paymentMode: 'online' | 'on_site';
  termsAcceptedAt?: Date | null;
}

/** VAT included in a gross amount. */
function includedTax(grossMinor: number, taxRateBps: number): number {
  return Math.round((grossMinor * taxRateBps) / (10_000 + taxRateBps));
}

@Injectable()
export class BookingService {
  private readonly logger = new Logger('Booking');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
    private readonly tenants: TenantsService,
    private readonly catalog: CatalogService,
    private readonly availability: AvailabilityService,
    private readonly links: LinksService,
    private readonly gateway: PaymentsGateway,
    private readonly outbox: Outbox,
    private readonly tickets: TicketsService,
    private readonly notifications: NotificationsService,
    private readonly sources: SourcesService,
  ) {}

  ticketUrl(bookingId: string): string {
    return `${this.config.WEB_URL}/t/${bookingId}?k=${ticketLinkKey(this.config.APP_SECRET, bookingId)}`;
  }

  async publicCheckout(tenantSlug: string, body: PublicCheckoutBody): Promise<CheckoutResultDto> {
    const tenant = await this.tenants.bySlug(tenantSlug);
    const attribution = await this.links.attribution(this.db, tenant.id, body.ref);
    return this.create({
      tenant,
      slotId: body.slotId,
      items: body.items,
      customer: body.customer,
      channel: attribution ? (body.refSource === 'qr' ? 'qr' : 'link') : 'direct',
      attribution,
      createdByUserId: null,
      paymentMode: 'online',
      termsAcceptedAt: this.clock.now(),
    });
  }

  async assistedBooking(
    tenantId: string,
    affiliateId: string,
    userId: string,
    body: AssistedBookingBody,
  ): Promise<CheckoutResultDto> {
    const tenant = await this.tenants.get(tenantId);
    const [affiliate] = await this.db
      .select()
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId));
    if (affiliate?.status !== 'active')
      throw new DomainError('errors.booking.affiliateInactive', HttpStatus.FORBIDDEN);
    if (body.payment === 'on_site' && !tenant.allowPayOnSite) {
      throw new DomainError('errors.booking.noPayOnSite');
    }
    const result = await this.create({
      tenant,
      slotId: body.slotId,
      items: body.items,
      customer: body.customer,
      channel: 'affiliate_assisted',
      attribution: { affiliateId, linkId: null },
      createdByUserId: userId,
      paymentMode: body.payment === 'on_site' ? 'on_site' : 'online',
    });
    // Pay-on-site bookings get their ticket when it is issued; online ones get the payment link.
    // The phone first: the customer is standing at the desk and reads an SMS at once.
    const contact = body.customer.phone ?? body.customer.email;
    if (contact && result.paymentUrl) {
      const { booking } = result;
      await this.notifications.enqueue(this.db, {
        to: contact,
        template: 'payment_link',
        locale: body.customer.locale,
        tenantId,
        dedupeKey: `payment_link:${booking.id}`,
        params: {
          tenantName: tenant.name,
          productName: booking.productName,
          reference: booking.reference,
          startsAt: booking.startsAt,
          timezone: tenant.timezone,
          totalMinor: booking.totalMinor,
          currency: booking.currency,
          url: result.paymentUrl,
        },
      });
    }
    return result;
  }

  private async create(input: CreateInput): Promise<CheckoutResultDto> {
    const { tenant } = input;
    const now = this.clock.now();
    const slot = await this.availability.slot(this.db, tenant.id, input.slotId);
    const product = await this.catalog.product(tenant.id, slot.productId);
    if (!product.active)
      throw new DomainError('errors.booking.tripUnavailable', HttpStatus.CONFLICT);

    const quantities = new Map<string, number>();
    for (const item of input.items)
      quantities.set(item.priceId, (quantities.get(item.priceId) ?? 0) + item.quantity);
    const prices = await this.catalog.prices(tenant.id, product.id, [...quantities.keys()]);
    if (prices.length !== quantities.size)
      throw new DomainError('errors.booking.unknownPrice', HttpStatus.BAD_REQUEST);

    const lines = prices.map((price) => ({ price, quantity: quantities.get(price.id)! }));
    const seats = lines.reduce((sum, l) => sum + l.quantity * l.price.seats, 0);
    const totalMinor = lines.reduce((sum, l) => sum + l.quantity * l.price.amountMinor, 0);
    const taxMinor = lines.reduce(
      (sum, l) => sum + includedTax(l.quantity * l.price.amountMinor, l.price.taxRateBps),
      0,
    );
    if (seats < 1) throw new DomainError('errors.booking.noSeats', HttpStatus.BAD_REQUEST);

    const onSite = input.paymentMode === 'on_site';
    const holdExpiresAt = new Date(now.getTime() + this.config.HOLD_MINUTES * 60_000);

    // Trips from the operator's own system: their system decides first whether the seats are free.
    this.availability.assertBookable(slot, now);
    const externalHoldId = product.sourceId
      ? await this.sources.hold(product, slot, seats, this.config.HOLD_MINUTES * 60)
      : null;

    const booking = await this.db
      .transaction(async (tx) => {
        const holdId = await this.availability.hold(
          tx,
          slot,
          seats,
          holdExpiresAt,
          now,
          externalHoldId,
        );
        const created = await this.insertBooking(tx, {
          tenantId: tenant.id,
          productId: product.id,
          slotId: slot.id,
          holdId,
          startsAt: slot.startsAt,
          status: onSite ? 'confirmed' : 'pending_payment',
          channel: input.channel,
          affiliateId: input.attribution?.affiliateId ?? null,
          linkId: input.attribution?.linkId ?? null,
          createdByUserId: input.createdByUserId,
          customerName: input.customer.name,
          customerEmail: input.customer.email ?? null,
          customerPhone: input.customer.phone ?? null,
          customerLocale: input.customer.locale,
          hotelRoom: input.customer.hotelRoom ?? null,
          seats,
          currency: tenant.currency,
          totalMinor,
          taxMinor,
          platformFeeMinor: applyRate(totalMinor, tenant.platformFeeBps),
          paymentMode: input.paymentMode,
          termsAcceptedAt: input.termsAcceptedAt ?? null,
          createdAt: now,
        });
        await tx.insert(bookingItems).values(
          lines.map((l) => ({
            bookingId: created.id,
            priceId: l.price.id,
            code: l.price.code,
            label: l.price.label,
            quantity: l.quantity,
            unitAmountMinor: l.price.amountMinor,
            taxRateBps: l.price.taxRateBps,
          })),
        );
        if (onSite) {
          await this.availability.confirmHold(tx, holdId, now);
          await this.tickets.issue(tx, created.id, tenant.id);
          await this.outbox.publish(tx, {
            type: 'booking.seats_confirmed',
            tenantId: tenant.id,
            bookingId: created.id,
          });
        }
        return created;
      })
      .catch(async (error: unknown) => {
        if (externalHoldId) await this.sources.release(product.id, externalHoldId);
        throw error;
      });

    let paymentUrl: string | null = null;
    if (!onSite) {
      try {
        const session = await this.gateway.createCheckout({
          bookingId: booking.id,
          tenantId: tenant.id,
          reference: booking.reference,
          currency: tenant.currency,
          lines: lines.map((l) => ({
            name: `${product.name} · ${l.price.label}`,
            unitAmountMinor: l.price.amountMinor,
            quantity: l.quantity,
          })),
          totalMinor,
          customerEmail: booking.customerEmail,
          locale: booking.customerLocale,
          successUrl: this.ticketUrl(booking.id),
          cancelUrl: `${this.config.WEB_URL}/b/${tenant.slug}/${product.slug}`,
          expiresAt: holdExpiresAt,
          connectedAccountId: tenant.stripeAccountId,
          applicationFeeMinor: booking.platformFeeMinor,
        });
        await this.db.insert(payments).values({
          tenantId: tenant.id,
          bookingId: booking.id,
          provider: this.gateway.name,
          checkoutSessionId: session.sessionId,
          amountMinor: totalMinor,
          currency: tenant.currency,
        });
        paymentUrl = session.url;
      } catch (error) {
        this.logger.error(`checkout failed for booking ${booking.id}: ${(error as Error).message}`);
        await this.db.transaction(async (tx) => {
          if (booking.holdId) await this.availability.releaseHold(tx, booking.holdId, now);
          await tx.update(bookings).set({ status: 'expired' }).where(eq(bookings.id, booking.id));
        });
        if (externalHoldId) await this.sources.release(product.id, externalHoldId);
        throw new DomainError('errors.booking.paymentsUnavailable', HttpStatus.BAD_GATEWAY);
      }
    }

    return {
      booking: await this.dto(booking.id),
      paymentUrl,
      ticketUrl: this.ticketUrl(booking.id),
    };
  }

  private async insertBooking(
    tx: DbOrTx,
    values: Omit<typeof bookings.$inferInsert, 'reference'>,
  ): Promise<Booking> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const [created] = await tx
        .insert(bookings)
        .values({ ...values, reference: randomCode(6) })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
    }
    throw new Error('could not generate a unique booking reference');
  }

  async exists(bookingId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return Boolean(row);
  }

  /**
   * The payment provider says money was given back outside the platform (a refund made in the
   * Stripe dashboard). A full refund cancels the booking: the ticket stops being valid, the seats
   * are freed and the affiliate's commission is reversed. A partial refund is only recorded.
   * Idempotent, and a no-op for refunds the platform made itself.
   */
  async refundedByProvider(paymentIntentId: string, refundedMinor: number): Promise<void> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paymentIntentId, paymentIntentId));
    if (!payment || payment.status === 'refunded') return;
    if (refundedMinor >= payment.amountMinor) {
      await this.cancel(payment.tenantId, payment.bookingId, 'refunded_in_stripe', null, null, {
        refundedByProvider: true,
      });
      // A booking that was not confirmed (unpaid in time, then paid and refunded) keeps its status.
      await this.db
        .update(payments)
        .set({
          status: 'refunded',
          refundedMinor: payment.amountMinor,
          updatedAt: this.clock.now(),
        })
        .where(eq(payments.id, payment.id));
      return;
    }
    if (refundedMinor <= payment.refundedMinor) return;
    await this.db
      .update(payments)
      .set({ refundedMinor, updatedAt: this.clock.now() })
      .where(eq(payments.id, payment.id));
    await this.db.insert(auditLog).values({
      tenantId: payment.tenantId,
      action: 'partial_refund_in_stripe',
      entityType: 'booking',
      entityId: payment.bookingId,
      data: { paymentIntentId, refundedMinor, amountMinor: payment.amountMinor },
    });
  }

  /** Called when the payment provider confirms the money arrived. Idempotent. */
  async confirmPayment(bookingId: string, paymentIntentId: string | null): Promise<void> {
    const now = this.clock.now();
    const late = await this.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update');
      if (!booking) throw new NotFound('booking');
      if (booking.status === 'confirmed') return null;

      await tx
        .update(payments)
        .set({ status: 'succeeded', paymentIntentId, updatedAt: now })
        .where(eq(payments.bookingId, booking.id));

      if (booking.status === 'cancelled' || booking.status === 'refunded') {
        await this.audit(tx, booking, 'payment_after_cancellation', { paymentIntentId });
        return booking;
      }
      const confirmed = booking.holdId
        ? await this.availability.confirmHold(tx, booking.holdId, now)
        : false;
      if (!confirmed) {
        // The hold expired before the money arrived: take the seats again if they are still free.
        // For a trip from the operator's own system, their system decides (SourcesService.confirm).
        const product = await this.catalog.product(booking.tenantId, booking.productId, tx);
        if (product.sourceId) {
          await this.availability.reserveCached(tx, booking.slotId, booking.seats);
        } else if (!(await this.availability.reserveLate(tx, booking.slotId, booking.seats))) {
          await this.audit(tx, booking, 'overbooked_after_late_payment', { seats: booking.seats });
        }
      }
      await tx
        .update(bookings)
        .set({ status: 'confirmed', paidAt: now })
        .where(eq(bookings.id, booking.id));
      await this.outbox.publish(tx, {
        type: 'booking.confirmed',
        tenantId: booking.tenantId,
        bookingId: booking.id,
        affiliateId: booking.affiliateId,
        paidAt: now.toISOString(),
        totalMinor: booking.totalMinor,
        taxMinor: booking.taxMinor,
        currency: booking.currency,
      });
      await this.outbox.publish(tx, {
        type: 'booking.seats_confirmed',
        tenantId: booking.tenantId,
        bookingId: booking.id,
      });
      return null;
    });
    if (late) await this.refundLatePayment(late);
  }

  /**
   * The customer paid for a booking that was already cancelled (the trip was called off while
   * they were on the payment page): the money goes straight back.
   */
  private async refundLatePayment(booking: Booking): Promise<void> {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, booking.id), eq(payments.status, 'succeeded')));
    if (!payment || payment.amountMinor <= payment.refundedMinor) return;
    const tenant = await this.tenants.get(booking.tenantId);
    await this.gateway.refund(
      payment.paymentIntentId,
      payment.amountMinor - payment.refundedMinor,
      Boolean(tenant.stripeAccountId),
    );
    await this.db
      .update(payments)
      .set({ status: 'refunded', refundedMinor: payment.amountMinor, updatedAt: this.clock.now() })
      .where(eq(payments.id, payment.id));
    await this.audit(this.db, booking, 'late_payment_refunded', {
      amountMinor: payment.amountMinor - payment.refundedMinor,
    });
  }

  /** Releases the seats of bookings whose customer did not pay in time. */
  async expireUnpaid(): Promise<number> {
    const now = this.clock.now();
    const stale = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(holds, eq(holds.id, bookings.holdId))
      .where(
        and(
          eq(bookings.status, 'pending_payment'),
          lte(holds.expiresAt, now),
          isNull(holds.releasedAt),
        ),
      )
      .limit(500);
    for (const { id } of stale) {
      const released = await this.db.transaction(async (tx) => {
        const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
        if (booking?.status !== 'pending_payment') return null;
        const externalHoldId = booking.holdId
          ? await this.availability.releaseHold(tx, booking.holdId, now)
          : null;
        await tx.update(bookings).set({ status: 'expired' }).where(eq(bookings.id, id));
        return externalHoldId ? { productId: booking.productId, externalHoldId } : null;
      });
      if (released) await this.sources.release(released.productId, released.externalHoldId);
    }
    return stale.length;
  }

  async cancel(
    tenantId: string,
    bookingId: string,
    reason: string,
    actorUserId: string | null,
    notice: CancellationNotice | null = null,
    options: { refundedByProvider?: boolean } = {},
  ): Promise<BookingDto> {
    const now = this.clock.now();
    const tenant = await this.tenants.get(tenantId);
    const [current] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId)));
    if (!current) throw new NotFound('booking');
    if (['cancelled', 'refunded', 'expired'].includes(current.status)) return this.dto(bookingId);
    // The operator's own system first: if it does not answer, nothing is cancelled or refunded.
    if (current.externalRef) await this.sources.cancel(current.productId, current.externalRef);

    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.bookingId, bookingId), eq(payments.status, 'succeeded')));
    if (payment && current.status === 'confirmed' && !options.refundedByProvider) {
      // Refund first: the provider call is idempotent per booking, the database update below is not lost.
      await this.gateway.refund(
        payment.paymentIntentId,
        payment.amountMinor - payment.refundedMinor,
        Boolean(tenant.stripeAccountId),
      );
    }

    const external = await this.db.transaction(async (tx) => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .for('update');
      if (!booking || ['cancelled', 'refunded', 'expired'].includes(booking.status)) return null;
      const wasConfirmed = booking.status === 'confirmed';
      let externalHoldId: string | null = null;
      if (wasConfirmed) await this.availability.freeSeats(tx, booking.slotId, booking.seats);
      else if (booking.holdId)
        externalHoldId = await this.availability.releaseHold(tx, booking.holdId, now);

      const refunded = Boolean(payment && wasConfirmed);
      await tx
        .update(bookings)
        .set({ status: refunded ? 'refunded' : 'cancelled', cancelledAt: now })
        .where(eq(bookings.id, bookingId));
      if (refunded && payment) {
        await tx
          .update(payments)
          .set({ status: 'refunded', refundedMinor: payment.amountMinor, updatedAt: now })
          .where(eq(payments.id, payment.id));
      }
      await this.tickets.void(tx, bookingId);
      if (wasConfirmed) await this.tickets.notifyCancelled(tx, tenant, booking, refunded, notice);
      await this.audit(tx, booking, 'booking_cancelled', { reason, actorUserId, refunded });
      // Confirmed in the operator's system after we read the booking above: cancel it there too.
      const lateRef =
        booking.externalRef && booking.externalRef !== current.externalRef
          ? booking.externalRef
          : null;
      if (wasConfirmed) {
        await this.outbox.publish(tx, {
          type: 'booking.cancelled',
          tenantId,
          bookingId,
          affiliateId: booking.affiliateId,
          reason,
          refunded,
        });
      }
      return { productId: booking.productId, externalHoldId, lateRef };
    });
    if (external?.externalHoldId) {
      await this.sources.release(external.productId, external.externalHoldId);
    }
    if (external?.lateRef) {
      await this.sources
        .cancel(external.productId, external.lateRef)
        .catch((error: unknown) =>
          this.logger.error(
            `booking ${bookingId} is cancelled here but not in the operator's system: ${(error as Error).message}`,
          ),
        );
    }
    return this.dto(bookingId);
  }

  /**
   * Calls off departures (bad weather...): closes them to new sales, then cancels every booking
   * on them one by one, so a refund that fails leaves the others cancelled and can be retried.
   */
  async cancelDepartures(
    tenantId: string,
    productId: string,
    body: CancelDeparturesBody,
    actorUserId: string,
  ): Promise<CancelDeparturesResultDto> {
    // A trip under way or over has passengers who already boarded: nothing to call off.
    const [started] = await this.db
      .select({ id: slots.id })
      .from(slots)
      .where(
        and(
          eq(slots.tenantId, tenantId),
          inArray(slots.id, body.slotIds),
          lte(slots.startsAt, this.clock.now()),
        ),
      )
      .limit(1);
    if (started) throw new DomainError('errors.departures.alreadyStarted', HttpStatus.CONFLICT);
    // Also checks the departures belong to this trip of the operator's own calendar.
    await this.catalog.updateSlots(tenantId, productId, { slotIds: body.slotIds, closed: true });
    const affected = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.productId, productId),
          inArray(bookings.slotId, body.slotIds),
          inArray(bookings.status, ['pending_payment', 'confirmed']),
        ),
      )
      .orderBy(bookings.startsAt);
    const notice: CancellationNotice = { reason: body.reason, message: body.message || null };
    const reason =
      body.reason === 'weather' ? 'departure_cancelled_weather' : 'departure_cancelled';
    let cancelled = 0;
    let refunded = 0;
    let failed = 0;
    for (const { id } of affected) {
      try {
        const result = await this.cancel(tenantId, id, reason, actorUserId, notice);
        cancelled += 1;
        if (result.status === 'refunded') refunded += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`could not cancel booking ${id}: ${(error as Error).message}`);
      }
    }
    const rows = await this.db
      .select()
      .from(slots)
      .where(and(eq(slots.tenantId, tenantId), inArray(slots.id, body.slotIds)))
      .orderBy(slots.startsAt);
    return { slots: rows.map(toOperatorSlotDto), cancelled, refunded, failed };
  }

  async listForAffiliate(affiliateId: string, limit = 50): Promise<BookingDto[]> {
    const ids = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.affiliateId, affiliateId),
          inArray(bookings.status, ['pending_payment', 'confirmed', 'cancelled', 'refunded']),
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(limit);
    return this.dtos(ids.map((r) => r.id));
  }

  async listForTenant(tenantId: string, fromDate: string, toDate: string): Promise<BookingDto[]> {
    const tenant = await this.tenants.get(tenantId);
    const from = DateTime.fromISO(fromDate, { zone: tenant.timezone }).startOf('day');
    const to = DateTime.fromISO(toDate, { zone: tenant.timezone }).plus({ days: 1 }).startOf('day');
    const ids = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          gte(bookings.startsAt, from.toJSDate()),
          lt(bookings.startsAt, to.toJSDate()),
          sql`${bookings.status} <> 'expired'`,
        ),
      )
      .orderBy(bookings.startsAt)
      .limit(1000);
    return this.dtos(ids.map((r) => r.id));
  }

  async dto(bookingId: string): Promise<BookingDto> {
    const [dto] = await this.dtos([bookingId]);
    if (!dto) throw new NotFound('booking');
    return dto;
  }

  private async dtos(ids: string[]): Promise<BookingDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        booking: bookings,
        productName: products.name,
        affiliateName: affiliates.displayName,
      })
      .from(bookings)
      .innerJoin(products, eq(products.id, bookings.productId))
      .leftJoin(affiliates, eq(affiliates.id, bookings.affiliateId))
      .where(inArray(bookings.id, ids));
    const byId = new Map(rows.map((r) => [r.booking.id, r]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const b = row.booking;
      return [
        {
          id: b.id,
          reference: b.reference,
          status: b.status,
          channel: b.channel,
          productName: row.productName,
          startsAt: b.startsAt.toISOString(),
          seats: b.seats,
          customerName: b.customerName,
          totalMinor: b.totalMinor,
          currency: b.currency,
          paymentMode: b.paymentMode,
          affiliateName: row.affiliateName,
          createdAt: b.createdAt.toISOString(),
          paidAt: b.paidAt?.toISOString() ?? null,
          externalRef: b.externalRef,
        },
      ];
    });
  }

  private async audit(
    tx: DbOrTx,
    booking: Booking,
    action: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(auditLog).values({
      tenantId: booking.tenantId,
      action,
      entityType: 'booking',
      entityId: booking.id,
      data,
    });
  }
}
