import { Module } from '@nestjs/common';
import { CommissionsModule } from '../commissions/commissions.module';
import { IdentityModule } from '../identity/identity.module';
import { TrackingModule } from '../tracking/tracking.module';
import { InvitesController, OperatorAffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';

@Module({
  imports: [IdentityModule, CommissionsModule, TrackingModule],
  providers: [AffiliatesService],
  controllers: [OperatorAffiliatesController, InvitesController],
})
export class AffiliatesModule {}
