import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AffiliateCatalogController, OperatorCatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  providers: [CatalogService, AvailabilityService],
  controllers: [OperatorCatalogController, AffiliateCatalogController],
  exports: [CatalogService, AvailabilityService],
})
export class CatalogModule {}
