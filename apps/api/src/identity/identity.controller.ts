import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthOptionsDto,
  type LoginHandoffBody,
  type MeDto,
  type PasswordLoginBody,
  type PasswordResetBody,
  type RequestOtpBody,
  type SessionDto,
  type VerifyMfaBody,
  type VerifyOtpBody,
  type VerifyOtpResultDto,
  loginHandoffBody,
  passwordLoginBody,
  passwordResetBody,
  requestOtpBody,
  verifyMfaBody,
  verifyOtpBody,
} from '@ap/contracts';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { ZodBody } from '../common/validation';
import { I18nService } from '../i18n/i18n.service';
import { IdentityService } from './identity.service';

const GOOGLE_COOKIE = 'ap_google_state';

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/** Only paths inside the web app, never another site. */
function safeNext(value: unknown): string | undefined {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && value.length <= 500
    ? value
    : undefined;
}

@Controller()
export class IdentityController {
  constructor(
    private readonly identity: IdentityService,
    private readonly i18n: I18nService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** What the sign-in page offers: SMS, Google, demo accounts. */
  @Get('auth/options')
  options(): Promise<AuthOptionsDto> {
    return this.identity.options();
  }

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

  /** Capped per IP too, so passwords cannot be tried across many email addresses at once. */
  @Post('auth/password/login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit('password-login', { limit: 30, windowMs: 15 * 60_000 })
  async passwordLogin(
    @ZodBody(passwordLoginBody) body: PasswordLoginBody,
    @Req() request: Request,
  ): Promise<VerifyOtpResultDto> {
    const result = await this.identity.loginWithPassword(body.email, body.password);
    if ('user' in result) await this.rememberLocale(result.user.id, request);
    return result;
  }

  /** Sets a password with a code from /auth/otp/request sent to the same email address. */
  @Post('auth/password/reset')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit('otp-verify', { limit: 30, windowMs: 15 * 60_000 })
  async passwordReset(
    @ZodBody(passwordResetBody) body: PasswordResetBody,
    @Req() request: Request,
  ): Promise<VerifyOtpResultDto> {
    const result = await this.identity.resetPassword(body.email, body.code, body.password);
    if ('user' in result) await this.rememberLocale(result.user.id, request);
    return result;
  }

  /** The "Continue with Google" button opens this URL; it sends the browser on to Google. */
  @Get('auth/google/start')
  googleStart(@Query('next') next: unknown, @Res() response: Response): void {
    const { url, nonce } = this.identity.googleStart(safeNext(next));
    response.cookie(GOOGLE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.API_URL.startsWith('https:'),
      path: '/auth/google',
      maxAge: 10 * 60_000,
    });
    response.redirect(302, url);
  }

  @Get('auth/google/callback')
  async googleCallback(
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const result = await this.identity.googleCallback({
      code: text(query.code),
      state: text(query.state),
      error: text(query.error),
      cookieNonce: readCookie(request, GOOGLE_COOKIE),
    });
    response.clearCookie(GOOGLE_COOKIE, { path: '/auth/google' });
    response.redirect(302, result.redirect);
  }

  @Post('auth/handoff')
  @HttpCode(200)
  async handoff(
    @ZodBody(loginHandoffBody) body: LoginHandoffBody,
    @Req() request: Request,
  ): Promise<VerifyOtpResultDto> {
    const result = await this.identity.exchangeHandoff(body.token);
    if ('user' in result) await this.rememberLocale(result.user.id, request);
    return result;
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
