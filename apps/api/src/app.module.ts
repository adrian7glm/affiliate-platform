import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { BoardingModule } from './boarding/boarding.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommissionsModule } from './commissions/commissions.module';
import { CommonModule } from './common/common.module';
import { APP_CONFIG, type AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { IdentityModule } from './identity/identity.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutboxModule } from './outbox/outbox.module';
import { PaymentsModule } from './payments/payments.module';
import { SourcesModule } from './sources/sources.module';
import { TrackingModule } from './tracking/tracking.module';

@Global()
@Module({})
class ConfigModule {
  static with(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}

/**
 * The modular monolith. Each module owns its tables and talks to the others through exported
 * services or outbox events; any of them can later become its own service.
 */
@Module({})
export class AppModule {
  static with(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.with(config),
        DatabaseModule,
        OutboxModule,
        CommonModule,
        NotificationsModule,
        IdentityModule,
        AffiliatesModule,
        TrackingModule,
        SourcesModule,
        CatalogModule,
        PaymentsModule,
        BookingModule,
        BoardingModule,
        CommissionsModule,
        JobsModule,
      ],
      controllers: [HealthController],
    };
  }
}
