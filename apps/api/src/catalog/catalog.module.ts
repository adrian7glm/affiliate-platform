import { Module } from '@nestjs/common';
import { SourcesModule } from '../sources/sources.module';
import { AvailabilityService } from './availability.service';
import { AffiliateCatalogController, OperatorCatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [SourcesModule],
  providers: [CatalogService, AvailabilityService],
  controllers: [OperatorCatalogController, AffiliateCatalogController],
  exports: [CatalogService, AvailabilityService],
})
export class CatalogModule {}
