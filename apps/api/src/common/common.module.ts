import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock, SystemClock } from './clock';
import { ConsoleNotifier, MemoryNotifier, Notifier } from './notifier';
import { TenantsService } from './tenants';
import { AuthGuard, TenantGuard } from './auth';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: Notifier,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Notifier =>
        config.NOTIFIER === 'console' ? new ConsoleNotifier() : new MemoryNotifier(),
    },
    TenantsService,
    AuthGuard,
    TenantGuard,
  ],
  exports: [Clock, Notifier, TenantsService, AuthGuard, TenantGuard],
})
export class CommonModule {}
