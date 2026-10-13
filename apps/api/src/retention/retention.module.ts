import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BookingModule } from '../booking/booking.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { PlatformModule } from '../platform/platform.module';
import { AffiliateNotificationsController } from './retention.controller';
import { RetentionService } from './retention.service';

/**
 * Automatic messages that bring people back: trip reminders and review requests for customers,
 * sale, level and payout messages for affiliates, the monthly report and billing warnings for
 * operators. Owns no tables; reads the others' and writes to the notification queue.
 */
@Module({
  imports: [CommissionsModule, AnalyticsModule, PlatformModule, BookingModule],
  providers: [RetentionService],
  controllers: [AffiliateNotificationsController],
  exports: [RetentionService],
})
export class RetentionModule {}
