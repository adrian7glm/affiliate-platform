import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { TrackingModule } from '../tracking/tracking.module';
import { AffiliateEarningsService } from './affiliate-earnings.service';
import { CommissionPlansService } from './commission-plans.service';
import {
  AffiliateCommissionsController,
  OperatorCommissionsController,
} from './commissions.controller';
import { CommissionLedgerService } from './ledger.service';
import { CommissionPayoutsService } from './payouts.service';

/** Commissions: plans, the ledger, what affiliates earn, and the operator's payouts. */
@Module({
  imports: [TrackingModule, BookingModule],
  providers: [
    CommissionPlansService,
    CommissionLedgerService,
    AffiliateEarningsService,
    CommissionPayoutsService,
  ],
  controllers: [AffiliateCommissionsController, OperatorCommissionsController],
  exports: [CommissionPlansService, CommissionLedgerService, AffiliateEarningsService],
})
export class CommissionsModule {}
