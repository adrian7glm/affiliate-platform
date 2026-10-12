import { Module } from '@nestjs/common';
import { AffiliateLinksController, PublicLinksController } from './links.controller';
import { LinksService } from './links.service';

@Module({
  providers: [LinksService],
  controllers: [AffiliateLinksController, PublicLinksController],
  exports: [LinksService],
})
export class TrackingModule {}
