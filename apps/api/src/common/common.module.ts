import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { TenantsService } from './tenants';
import { AuthGuard, TenantGuard } from './auth';
import { RateLimitGuard, RateLimiter } from './rate-limit';
import { PlatformSettings } from './platform-settings';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    TenantsService,
    AuthGuard,
    TenantGuard,
    RateLimiter,
    RateLimitGuard,
    PlatformSettings,
  ],
  exports: [
    Clock,
    TenantsService,
    AuthGuard,
    TenantGuard,
    RateLimiter,
    RateLimitGuard,
    PlatformSettings,
  ],
})
export class CommonModule {}
