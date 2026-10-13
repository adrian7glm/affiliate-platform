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
import { ZodBody } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { IdentityService } from './identity.service';

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly i18n: I18nService,
  ) {}

  @Post('auth/otp/request')
  @HttpCode(204)
  async requestOtp(
    @ZodBody(requestOtpBody) body: RequestOtpBody,
    @Req() request: Request,
  ): Promise<void> {
    // The language of the login screen, else the browser's.
    const locale = this.i18n.pick(body.locale, this.i18n.langOf(request));
    await this.identity.requestOtp(body.destination, locale);
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @ZodBody(verifyOtpBody) body: VerifyOtpBody,
    @Req() request: Request,
  ): Promise<SessionDto> {
    const session = await this.identity.verifyOtp(body.destination, body.code);
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
