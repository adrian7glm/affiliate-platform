import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminAccountDto,
  type AdminAccountLookupDto,
  type AdminAccountQuery,
  adminAccountQuery,
} from '@ap/contracts';
import type { Request } from 'express';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { ZodQuery } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { AccountService } from './account.service';

/** Platform support: look up a person's account, reset their two-step login, sign them out. */
@Controller('admin/accounts')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminAccountsController {
  constructor(
    private readonly account: AccountService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  async find(
    @ZodQuery(adminAccountQuery) query: AdminAccountQuery,
  ): Promise<AdminAccountLookupDto> {
    return { account: await this.account.findForAdmin(query.contact) };
  }

  @Post(':id/2fa/reset')
  @HttpCode(200)
  resetTwoFactor(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminAccountDto> {
    return this.account.resetTwoFactorForAdmin(admin.id, id, this.i18n.langOf(request));
  }

  @Post(':id/sign-out')
  @HttpCode(200)
  signOut(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminAccountDto> {
    return this.account.signOutForAdmin(admin.id, id);
  }
}
