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
  type VerifyOtpBody,
  loginHandoffBody,
  passwordLoginBody,
  passwordResetBody,
  requestOtpBody,
  verifyOtpBody,
} from '@ap/contracts';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
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
  verifyOtp(@ZodBody(verifyOtpBody) body: VerifyOtpBody): Promise<SessionDto> {
    return this.identity.verifyOtp(body.destination, body.code);
  }

  @Post('auth/password/login')
  @HttpCode(200)
  passwordLogin(@ZodBody(passwordLoginBody) body: PasswordLoginBody): Promise<SessionDto> {
    return this.identity.loginWithPassword(body.email, body.password);
  }

  /** Sets a password with a code from /auth/otp/request sent to the same email address. */
  @Post('auth/password/reset')
  @HttpCode(200)
  passwordReset(@ZodBody(passwordResetBody) body: PasswordResetBody): Promise<SessionDto> {
    return this.identity.resetPassword(body.email, body.code, body.password);
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
  handoff(@ZodBody(loginHandoffBody) body: LoginHandoffBody): Promise<SessionDto> {
    return this.identity.exchangeHandoff(body.token);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.identity.me(user.id);
  }
}
