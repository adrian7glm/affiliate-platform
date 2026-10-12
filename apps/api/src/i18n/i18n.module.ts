import { Global, Module } from '@nestjs/common';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { I18nAdminController, I18nController } from './i18n.controller';
import { I18nService } from './i18n.service';

/** Languages, translated texts and the platform admin's translation editor. */
@Global()
@Module({
  providers: [I18nService, PlatformAdminGuard],
  controllers: [I18nController, I18nAdminController],
  exports: [I18nService],
})
export class I18nModule {}
