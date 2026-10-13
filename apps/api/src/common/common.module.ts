import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { TenantsService } from './tenants';
import { AuthGuard, TenantGuard } from './auth';

@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }, TenantsService, AuthGuard, TenantGuard],
  exports: [Clock, TenantsService, AuthGuard, TenantGuard],
})
export class CommonModule {}
