import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  DepartureDayDto,
  DeparturePassengersDto,
  DepartureSummaryDto,
  PassengerDto,
} from '@ap/contracts';
import {
  type Database,
  affiliates,
  bookingItems,
  bookings,
  products,
  slots,
  tickets,
} from '@ap/db';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DomainError, NotFound } from '../common/errors';
import { TenantsService } from '../common/tenants';
import { DB } from '../database/database.module';

/** Bookings that hold seats on a departure: paid ones and those still being paid. */
const ON_BOARD = ['confirmed', 'pending_payment'] as const;

/**
 * The boarding list: a day's departures across all trips, and who is on each one. Departures
 * are read from our calendar (for trips from the operator's own system, as last synced).
 */
@Injectable()
export class DeparturesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tenants: TenantsService,
  ) {}

  /** Every departure of a local day, including those that already left. */
  async day(tenantId: string, date: string): Promise<DepartureDayDto> {
    const tenant = await this.tenants.get(tenantId);
    const from = DateTime.fromISO(date, { zone: tenant.timezone }).startOf('day');
    if (!from.isValid) {
      throw new DomainError('errors.period.dateFormat', HttpStatus.BAD_REQUEST, undefined, {
        name: 'date',
      });
    }
    const rows = await this.db
      .select({ slot: slots, productName: products.name })
      .from(slots)
      .innerJoin(products, eq(products.id, slots.productId))
      .where(
        and(
          eq(slots.tenantId, tenantId),
          gte(slots.startsAt, from.toJSDate()),
          lt(slots.startsAt, from.plus({ days: 1 }).toJSDate()),
        ),
      )
      .orderBy(asc(slots.startsAt), asc(products.name));
    const counts = await this.counts(rows.map((r) => r.slot.id));
    return {
      date,
      timezone: tenant.timezone,
      departures: rows
        .map((r) => summary(r.slot, r.productName, counts.get(r.slot.id)))
        // A closed departure nobody booked is not a departure at all.
        .filter((d) => !d.closed || d.bookings > 0 || d.pendingPayment > 0),
    };
  }

  async passengers(tenantId: string, slotId: string): Promise<DeparturePassengersDto> {
    const tenant = await this.tenants.get(tenantId);
    const [row] = await this.db
      .select({ slot: slots, productName: products.name })
      .from(slots)
      .innerJoin(products, eq(products.id, slots.productId))
      .where(and(eq(slots.id, slotId), eq(slots.tenantId, tenantId)));
    if (!row) throw new NotFound('departure');

    const list = await this.db
      .select({
        booking: bookings,
        affiliateName: affiliates.displayName,
        boardedAt: tickets.checkedInAt,
        ticketStatus: tickets.status,
      })
      .from(bookings)
      .leftJoin(affiliates, eq(affiliates.id, bookings.affiliateId))
      .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.tenantId, tenantId),
          eq(bookings.slotId, slotId),
          inArray(bookings.status, [...ON_BOARD]),
        ),
      )
      .orderBy(asc(bookings.customerName), asc(bookings.reference));
    const items = list.length
      ? await this.db
          .select({
            bookingId: bookingItems.bookingId,
            label: bookingItems.label,
            quantity: bookingItems.quantity,
          })
          .from(bookingItems)
          .where(
            inArray(
              bookingItems.bookingId,
              list.map((r) => r.booking.id),
            ),
          )
      : [];
    const counts = await this.counts([slotId]);

    const passengers: PassengerDto[] = list.map(({ booking: b, ...r }) => ({
      bookingId: b.id,
      reference: b.reference,
      status: b.status as PassengerDto['status'],
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      customerEmail: b.customerEmail,
      customerLocale: b.customerLocale,
      hotelRoom: b.hotelRoom,
      seats: b.seats,
      items: items
        .filter((i) => i.bookingId === b.id)
        .map((i) => ({ label: i.label, quantity: i.quantity })),
      paymentMode: b.paymentMode,
      amountDueMinor:
        b.status === 'confirmed' && b.paymentMode === 'on_site' && !b.paidAt ? b.totalMinor : 0,
      currency: b.currency,
      affiliateName: r.affiliateName,
      answers: b.answers,
      boardedAt: r.ticketStatus === 'checked_in' ? (r.boardedAt?.toISOString() ?? null) : null,
    }));
    return {
      departure: summary(row.slot, row.productName, counts.get(slotId)),
      timezone: tenant.timezone,
      passengers,
    };
  }

  private async counts(slotIds: string[]): Promise<Map<string, Counts>> {
    if (slotIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        slotId: bookings.slotId,
        seatsBooked: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'confirmed'), 0)::int`,
        seatsBoarded: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'confirmed' and ${tickets.status} = 'checked_in'), 0)::int`,
        bookings: sql<number>`(count(*) filter (where ${bookings.status} = 'confirmed'))::int`,
        pendingPayment: sql<number>`(count(*) filter (where ${bookings.status} = 'pending_payment'))::int`,
      })
      .from(bookings)
      .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
      .where(and(inArray(bookings.slotId, slotIds), inArray(bookings.status, [...ON_BOARD])))
      .groupBy(bookings.slotId);
    return new Map(rows.map((r) => [r.slotId, r]));
  }
}

type Counts = Pick<
  DepartureSummaryDto,
  'seatsBooked' | 'seatsBoarded' | 'bookings' | 'pendingPayment'
>;

function summary(
  slot: typeof slots.$inferSelect,
  productName: string,
  counts: Counts | undefined,
): DepartureSummaryDto {
  return {
    slotId: slot.id,
    productId: slot.productId,
    productName,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    capacity: slot.capacity,
    closed: slot.closed,
    seatsBooked: counts?.seatsBooked ?? 0,
    seatsBoarded: counts?.seatsBoarded ?? 0,
    bookings: counts?.bookings ?? 0,
    pendingPayment: counts?.pendingPayment ?? 0,
  };
}
