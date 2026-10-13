import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  type AccountSecurityDto,
  type ContactChangeRequestBody,
  type ContactChangeVerifyBody,
  type MeDto,
  type NewSessionTokenDto,
  type RecoveryCodesDto,
  type TwoFactorCodeBody,
  type TwoFactorEnabledDto,
  type TwoFactorSetupDto,
  contactChangeRequestBody,
  contactChangeVerifyBody,
  twoFactorCodeBody,
} from '@ap/contracts';
import type { Request } from 'express';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { ZodBody } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { AccountService } from './account.service';

/** The signed-in person's own account, in every role (no operator header needed). */
@Controller('account')
@UseGuards(AuthGuard, RateLimitGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly i18n: I18nService,
  ) {}

  @Get('security')
  security(@CurrentUser() user: AuthUser): Promise<AccountSecurityDto> {
    return this.account.security(user.id);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser): Promise<TwoFactorSetupDto> {
    return this.account.startTwoFactor(user.id);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @RateLimit('account-2fa', { limit: 20, windowMs: 15 * 60_000 })
  enable(
    @CurrentUser() user: AuthUser,
    @ZodBody(twoFactorCodeBody) body: TwoFactorCodeBody,
    @Req() request: Request,
  ): Promise<TwoFactorEnabledDto> {
    return this.account.enableTwoFactor(user.id, body.code, this.i18n.langOf(request));
  }

  @Post('2fa/disable')
  @HttpCode(200)
  @RateLimit('account-2fa', { limit: 20, windowMs: 15 * 60_000 })
  disable(
    @CurrentUser() user: AuthUser,
    @ZodBody(twoFactorCodeBody) body: TwoFactorCodeBody,
    @Req() request: Request,
  ): Promise<MeDto> {
    return this.account.disableTwoFactor(user.id, body.code, this.i18n.langOf(request));
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  @RateLimit('account-2fa', { limit: 20, windowMs: 15 * 60_000 })
  recoveryCodes(
    @CurrentUser() user: AuthUser,
    @ZodBody(twoFactorCodeBody) body: TwoFactorCodeBody,
  ): Promise<RecoveryCodesDto> {
    return this.account.regenerateRecoveryCodes(user.id, body.code);
  }

  @Post('sessions/sign-out-others')
  @HttpCode(200)
  signOutOthers(@CurrentUser() user: AuthUser): Promise<NewSessionTokenDto> {
    return this.account.signOutOtherDevices(user.id);
  }

  @Post('contact/request')
  @HttpCode(204)
  @RateLimit('otp-request', { limit: 10, windowMs: 15 * 60_000 })
  async requestContactChange(
    @CurrentUser() user: AuthUser,
    @ZodBody(contactChangeRequestBody) body: ContactChangeRequestBody,
    @Req() request: Request,
  ): Promise<void> {
    const locale = this.i18n.pick(body.locale, this.i18n.langOf(request));
    await this.account.requestContactChange(user.id, body.destination, locale);
  }

  @Post('contact/verify')
  @HttpCode(200)
  @RateLimit('otp-verify', { limit: 30, windowMs: 15 * 60_000 })
  confirmContactChange(
    @CurrentUser() user: AuthUser,
    @ZodBody(contactChangeVerifyBody) body: ContactChangeVerifyBody,
    @Req() request: Request,
  ): Promise<MeDto> {
    return this.account.confirmContactChange(
      user.id,
      body.destination,
      body.code,
      this.i18n.langOf(request),
    );
  }
}
