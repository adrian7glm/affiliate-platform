import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { GoogleClient } from './google.client';
import { IdentityService } from './identity.service';

@Module({
  providers: [IdentityService, GoogleClient],
  controllers: [IdentityController],
  exports: [IdentityService],
})
export class IdentityModule {}
