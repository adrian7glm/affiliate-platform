import { Controller, Get, Inject, Patch, UseGuards } from '@nestjs/common';
import {
  type PlatformSettingsDto,
  type UpdatePlatformSettingsBody,
  updatePlatformSettingsBody,
} from '@ap/contracts';
import { type Database, auditLog } from '@ap/db';
import { APP_CONFIG, type AppConfig } from '../config';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { PlatformSettings } from '../common/platform-settings';
import { ZodBody } from '../common/validation';
import { DB } from '../database/database.module';
import { PlatformAdminGuard } from './platform-admin.guard';

/** Platform-wide switches in the admin area, e.g. whether people can sign in with an SMS code. */
@Controller('admin/settings')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformSettingsController {
  constructor(
    private readonly settings: PlatformSettings,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  async get(): Promise<PlatformSettingsDto> {
    return {
      smsLogin: await this.settings.get('sms_login'),
      smsAvailable: this.config.SMS_PROVIDER !== 'disabled',
      googleLogin: Boolean(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET),
      demoMode: this.config.DEMO_MODE,
    };
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @ZodBody(updatePlatformSettingsBody) body: UpdatePlatformSettingsBody,
  ): Promise<PlatformSettingsDto> {
    if (body.smsLogin !== undefined) {
      await this.settings.set('sms_login', body.smsLogin);
      await this.db.insert(auditLog).values({
        actorUserId: user.id,
        action: body.smsLogin ? 'sms_login_on' : 'sms_login_off',
        entityType: 'platform_setting',
        entityId: 'sms_login',
      });
    }
    return this.get();
  }
}
