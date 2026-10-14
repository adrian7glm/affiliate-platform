import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { CommissionsModule } from '../commissions/commissions.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { RetentionModule } from '../retention/retention.module';
import { SourcesModule } from '../sources/sources.module';
import { CleanupService } from './cleanup.service';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [BookingModule, CommissionsModule, IntegrationsModule, SourcesModule, RetentionModule],
  providers: [SchedulerService, CleanupService],
  exports: [CleanupService],
})
export class JobsModule {}
