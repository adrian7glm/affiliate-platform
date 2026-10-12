import { z } from 'zod';

/**
 * Domain events exchanged between modules through the transactional outbox.
 * A module never reads another module's tables to react to a change: it subscribes to these.
 */

const isoDate = z.string().datetime({ offset: true });

export const bookingConfirmedEvent = z.object({
  type: z.literal('booking.confirmed'),
  tenantId: z.string().uuid(),
  bookingId: z.string().uuid(),
  affiliateId: z.string().uuid().nullable(),
  paidAt: isoDate,
  totalMinor: z.number().int(),
  taxMinor: z.number().int(),
  currency: z.string().length(3),
});

/**
 * The booking's seats are definitively taken: paid online, or booked to be paid at boarding.
 * Lets an external availability source turn its temporary hold into a booking.
 */
export const bookingSeatsConfirmedEvent = z.object({
  type: z.literal('booking.seats_confirmed'),
  tenantId: z.string().uuid(),
  bookingId: z.string().uuid(),
});

export const bookingCancelledEvent = z.object({
  type: z.literal('booking.cancelled'),
  tenantId: z.string().uuid(),
  bookingId: z.string().uuid(),
  affiliateId: z.string().uuid().nullable(),
  reason: z.string(),
  refunded: z.boolean(),
});

export const ticketCheckedInEvent = z.object({
  type: z.literal('ticket.checked_in'),
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  bookingId: z.string().uuid(),
  checkedInAt: isoDate,
});

export const ticketIssuedEvent = z.object({
  type: z.literal('ticket.issued'),
  tenantId: z.string().uuid(),
  ticketId: z.string().uuid(),
  bookingId: z.string().uuid(),
});

export const domainEvent = z.discriminatedUnion('type', [
  bookingConfirmedEvent,
  bookingSeatsConfirmedEvent,
  bookingCancelledEvent,
  ticketCheckedInEvent,
  ticketIssuedEvent,
]);

export type DomainEvent = z.infer<typeof domainEvent>;
export type DomainEventType = DomainEvent['type'];
export type EventOfType<T extends DomainEventType> = Extract<DomainEvent, { type: T }>;
