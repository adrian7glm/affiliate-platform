import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  type MeDto,
  type RequestOtpBody,
  type SessionDto,
  type VerifyOtpBody,
  requestOtpBody,
  verifyOtpBody,
} from '@ap/contracts';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { ZodBody } from '../common/validation';
import { IdentityService } from './identity.service';

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('auth/otp/request')
  @HttpCode(204)
  async requestOtp(@ZodBody(requestOtpBody) body: RequestOtpBody): Promise<void> {
    await this.identity.requestOtp(body.destination);
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  verifyOtp(@ZodBody(verifyOtpBody) body: VerifyOtpBody): Promise<SessionDto> {
    return this.identity.verifyOtp(body.destination, body.code);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.identity.me(user.id);
  }
}
