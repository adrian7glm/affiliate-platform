import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { TenantsService } from './tenants';
import { AuthGuard, TenantGuard } from './auth';
import { RateLimitGuard, RateLimiter } from './rate-limit';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    TenantsService,
    AuthGuard,
    TenantGuard,
    RateLimiter,
    RateLimitGuard,
  ],
  exports: [Clock, TenantsService, AuthGuard, TenantGuard, RateLimiter, RateLimitGuard],
})
export class CommonModule {}
