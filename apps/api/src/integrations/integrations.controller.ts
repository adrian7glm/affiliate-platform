import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type CalendarFeedDto,
  type CreateWebhookBody,
  type CreatedWebhookDto,
  type UpdateWebhookBody,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookSecretDto,
  type WebhookTestResultDto,
  createWebhookBody,
  updateWebhookBody,
} from '@ap/contracts';
import type { Response } from 'express';
import {
  type AuthUser,
  AuthGuard,
  CurrentTenant,
  CurrentUser,
  Roles,
  type TenantContext,
  TenantGuard,
} from '../common/auth';
import { NotFound } from '../common/errors';
import { ZodBody } from '../common/validation';
import { CalendarFeedService } from './calendar-feed.service';
import { WebhooksService } from './webhooks.service';

/**
 * Webhooks send customers' contact details to other software, so only the owner manages them.
 */
@Controller('operator/webhooks')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<WebhookEndpointDto[]> {
    return this.webhooks.list(tenant.tenantId);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @ZodBody(createWebhookBody) body: CreateWebhookBody,
  ): Promise<CreatedWebhookDto> {
    return this.webhooks.create(tenant.tenantId, user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateWebhookBody) body: UpdateWebhookBody,
  ): Promise<WebhookEndpointDto> {
    return this.webhooks.update(tenant.tenantId, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.webhooks.remove(tenant.tenantId, user.id, id);
  }

  @Get(':id/secret')
  async secret(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookSecretDto> {
    return { secret: await this.webhooks.secret(tenant.tenantId, id) };
  }

  @Post(':id/test')
  @HttpCode(200)
  test(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookTestResultDto> {
    return this.webhooks.test(tenant.tenantId, id);
  }

  @Get(':id/deliveries')
  deliveries(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDeliveryDto[]> {
    return this.webhooks.deliveries(tenant.tenantId, id);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @HttpCode(200)
  retry(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDeliveryDto> {
    return this.webhooks.retry(tenant.tenantId, id, deliveryId);
  }
}

@Controller('operator/calendar-feed')
@UseGuards(AuthGuard, TenantGuard)
@Roles('owner', 'staff')
export class CalendarFeedController {
  constructor(private readonly feed: CalendarFeedService) {}

  @Get()
  async get(@CurrentTenant() tenant: TenantContext): Promise<CalendarFeedDto> {
    return { token: await this.feed.token(tenant.tenantId) };
  }

  @Post('reset')
  @HttpCode(200)
  @Roles('owner')
  async reset(@CurrentTenant() tenant: TenantContext): Promise<CalendarFeedDto> {
    return { token: await this.feed.reset(tenant.tenantId) };
  }
}

/** What Google Calendar, Outlook and phones fetch: no login, the token in the address is the key. */
@Controller('public/calendar')
export class PublicCalendarController {
  constructor(private readonly feed: CalendarFeedService) {}

  @Get(':file')
  async ics(
    @Param('file') file: string,
    @Query('lang') lang: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (!file.endsWith('.ics')) throw new NotFound('calendar');
    const content = await this.feed.ics(
      file.slice(0, -'.ics'.length),
      typeof lang === 'string' ? lang : null,
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline; filename="departures.ics"');
    return content;
  }
}
