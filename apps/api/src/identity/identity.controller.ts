import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  type MeDto,
  type RequestOtpBody,
  type SessionDto,
  type VerifyOtpBody,
  requestOtpBody,
  verifyOtpBody,
} from '@ap/contracts';
import type { Request } from 'express';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { ZodBody } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { IdentityService } from './identity.service';

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly i18n: I18nService,
  ) {}

  /** Each code is an SMS or email we pay for: capped per IP against SMS pumping. */
  @Post('auth/otp/request')
  @HttpCode(204)
  @UseGuards(RateLimitGuard)
  @RateLimit('otp-request', { limit: 10, windowMs: 15 * 60_000 })
  async requestOtp(
    @ZodBody(requestOtpBody) body: RequestOtpBody,
    @Req() request: Request,
  ): Promise<void> {
    // The language of the login screen, else the browser's.
    const locale = this.i18n.pick(body.locale, this.i18n.langOf(request));
    await this.identity.requestOtp(body.destination, locale);
  }

  /** Capped per IP so codes cannot be guessed across many phone numbers at once. */
  @Post('auth/otp/verify')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit('otp-verify', { limit: 30, windowMs: 15 * 60_000 })
  verifyOtp(@ZodBody(verifyOtpBody) body: VerifyOtpBody): Promise<SessionDto> {
    return this.identity.verifyOtp(body.destination, body.code);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.identity.me(user.id);
  }
}
