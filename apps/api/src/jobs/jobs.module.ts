import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [BookingModule, CommissionsModule], providers: [SchedulerService] })
export class JobsModule {}
