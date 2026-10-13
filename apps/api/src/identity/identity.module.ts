import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  providers: [IdentityService, AccountService],
  controllers: [IdentityController, AccountController],
  exports: [IdentityService],
})
export class IdentityModule {}
