import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { SourcesModule } from '../sources/sources.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [BookingModule, CommissionsModule, SourcesModule],
  providers: [SchedulerService],
})
export class JobsModule {}
