import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { TrackingModule } from '../tracking/tracking.module';
import {
  AffiliateCommissionsController,
  OperatorCommissionsController,
} from './commissions.controller';
import { CommissionsService } from './commissions.service';

@Module({
  imports: [TrackingModule, BookingModule],
  providers: [CommissionsService],
  controllers: [AffiliateCommissionsController, OperatorCommissionsController],
  exports: [CommissionsService],
})
export class CommissionsModule {}
