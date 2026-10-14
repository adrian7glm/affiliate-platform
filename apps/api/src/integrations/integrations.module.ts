import { Module, type OnModuleInit } from '@nestjs/common';
import { Outbox } from '../outbox/outbox';
import { CalendarFeedService } from './calendar-feed.service';
import {
  CalendarFeedController,
  PublicCalendarController,
  WebhooksController,
} from './integrations.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Connections to the operator's other software: webhooks and the departures calendar feed.
 * It only listens to outbox events and reads bookings; no other module depends on it.
 */
@Module({
  providers: [WebhooksService, CalendarFeedService],
  controllers: [WebhooksController, CalendarFeedController, PublicCalendarController],
  exports: [WebhooksService],
})
export class IntegrationsModule implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('booking.seats_confirmed', 'webhooks.booking-confirmed', (event, tx) =>
      this.webhooks.enqueue(tx, event.tenantId, 'booking.confirmed', event.bookingId),
    );
    this.outbox.on('booking.confirmed', 'webhooks.booking-paid', (event, tx) =>
      this.webhooks.enqueue(tx, event.tenantId, 'booking.paid', event.bookingId),
    );
    this.outbox.on('booking.cancelled', 'webhooks.booking-cancelled', (event, tx) =>
      this.webhooks.enqueue(tx, event.tenantId, 'booking.cancelled', event.bookingId, {
        cancellation: { reason: event.reason, refunded: event.refunded },
      }),
    );
    this.outbox.on('ticket.checked_in', 'webhooks.ticket-checked-in', (event, tx) =>
      this.webhooks.enqueue(tx, event.tenantId, 'ticket.checked_in', event.bookingId, {
        checkIn: { ticketId: event.ticketId, checkedInAt: event.checkedInAt },
      }),
    );
  }
}
