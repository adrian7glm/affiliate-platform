import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AdminAccountsController } from './admin-accounts.controller';
import { IdentityController } from './identity.controller';
import { GoogleClient } from './google.client';
import { IdentityService } from './identity.service';

@Module({
  providers: [IdentityService, AccountService, GoogleClient],
  controllers: [IdentityController, AccountController, AdminAccountsController],
  exports: [IdentityService],
})
export class IdentityModule {}
