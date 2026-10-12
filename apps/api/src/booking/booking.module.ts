import { Module, type OnModuleInit } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { Outbox } from '../outbox/outbox';
import { PaymentsModule } from '../payments/payments.module';
import { SourcesModule } from '../sources/sources.module';
import { StripeWebhookController } from '../payments/stripe-webhook.controller';
import { TrackingModule } from '../tracking/tracking.module';
import {
  AffiliateBookingController,
  OperatorBookingController,
  PublicBookingController,
} from './booking.controller';
import { BookingService } from './booking.service';
import { TicketsService } from './tickets.service';

@Module({
  imports: [CatalogModule, TrackingModule, PaymentsModule, SourcesModule],
  providers: [BookingService, TicketsService],
  controllers: [
    PublicBookingController,
    AffiliateBookingController,
    OperatorBookingController,
    StripeWebhookController,
  ],
  exports: [BookingService, TicketsService],
})
export class BookingModule implements OnModuleInit {
  constructor(
    private readonly outbox: Outbox,
    private readonly tickets: TicketsService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('booking.confirmed', 'tickets.issue', (event, tx) =>
      this.tickets.issue(tx, event.bookingId, event.tenantId),
    );
  }
}
