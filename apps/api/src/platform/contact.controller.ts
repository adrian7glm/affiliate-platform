import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  type ContactRequestBody,
  type ContactRequestDto,
  type SetContactHandledBody,
  contactRequestBody,
  setContactHandledBody,
} from '@ap/contracts';
import { AuthGuard } from '../common/auth';
import { RateLimit, RateLimitGuard } from '../common/rate-limit';
import { ZodBody } from '../common/validation';
import { ContactService } from './contact.service';
import { PlatformAdminGuard } from './platform-admin.guard';

/** The contact page on the platform's own site: anyone can write, no account needed. */
@Controller('public/contact')
export class PublicContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(204)
  @UseGuards(RateLimitGuard)
  @RateLimit('contact', { limit: 5, windowMs: 60 * 60_000 })
  async submit(@ZodBody(contactRequestBody) body: ContactRequestBody): Promise<void> {
    await this.contact.submit(body);
  }
}

/** The platform owner's inbox of contact page messages. */
@Controller('admin/contact-requests')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class AdminContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  list(): Promise<ContactRequestDto[]> {
    return this.contact.list();
  }

  @Post(':id/handled')
  @HttpCode(200)
  setHandled(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setContactHandledBody) body: SetContactHandledBody,
  ): Promise<ContactRequestDto> {
    return this.contact.setHandled(id, body.handled);
  }
}
