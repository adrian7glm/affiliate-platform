import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { TenantsService } from './tenants';
import { AuthGuard, TenantGuard } from './auth';
import { PlatformSettings } from './platform-settings';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    TenantsService,
    AuthGuard,
    TenantGuard,
    PlatformSettings,
  ],
  exports: [Clock, TenantsService, AuthGuard, TenantGuard, PlatformSettings],
})
export class CommonModule {}
