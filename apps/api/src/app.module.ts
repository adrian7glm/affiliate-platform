import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BoardingModule } from './boarding/boarding.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommissionsModule } from './commissions/commissions.module';
import { CommonModule } from './common/common.module';
import { APP_CONFIG, type AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { DiscountsModule } from './discounts/discounts.module';
import { HealthController } from './health.controller';
import { I18nModule } from './i18n/i18n.module';
import { IdentityModule } from './identity/identity.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { JobsModule } from './jobs/jobs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OutboxModule } from './outbox/outbox.module';
import { PaymentsModule } from './payments/payments.module';
import { SettingsModule } from './settings/settings.module';
import { PlatformModule } from './platform/platform.module';
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
        I18nModule,
        NotificationsModule,
        IdentityModule,
        AffiliatesModule,
        TrackingModule,
        SourcesModule,
        CatalogModule,
        DiscountsModule,
        PaymentsModule,
        BookingModule,
        BoardingModule,
        CommissionsModule,
        AnalyticsModule,
        SettingsModule,
        PlatformModule,
        IntegrationsModule,
        JobsModule,
      ],
      controllers: [HealthController],
    };
  }
}
