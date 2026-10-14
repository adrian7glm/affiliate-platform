import { Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  type MeDto,
  type RequestOtpBody,
  type SessionDto,
  type VerifyMfaBody,
  type VerifyOtpBody,
  type VerifyOtpResultDto,
  requestOtpBody,
  verifyMfaBody,
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
  async verifyOtp(
    @ZodBody(verifyOtpBody) body: VerifyOtpBody,
    @Req() request: Request,
  ): Promise<VerifyOtpResultDto> {
    const result = await this.identity.verifyOtp(body.destination, body.code);
    if ('user' in result) await this.rememberLocale(result.user.id, request);
    return result;
  }

  /** Second step for people with two-step login on: a code from their authenticator app. */
  @Post('auth/mfa/verify')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit('mfa-verify', { limit: 30, windowMs: 15 * 60_000 })
  async verifyMfa(
    @ZodBody(verifyMfaBody) body: VerifyMfaBody,
    @Req() request: Request,
  ): Promise<SessionDto> {
    const session = await this.identity.verifyMfa(body.mfaToken, body.code);
    await this.rememberLocale(session.user.id, request);
    return session;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthUser, @Req() request: Request): Promise<MeDto> {
    await this.rememberLocale(user.id, request);
    return this.identity.me(user.id);
  }

  /** The app sends its language with every call: messages to this person follow it. */
  private async rememberLocale(userId: string, request: Request): Promise<void> {
    // Only a language the platform offers; an unknown one leaves the stored choice alone.
    const lang = this.i18n.pick(request.headers['accept-language'], '');
    if (lang) await this.identity.setLocale(userId, lang);
  }
}
