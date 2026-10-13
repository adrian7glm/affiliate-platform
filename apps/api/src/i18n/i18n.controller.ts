import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminLanguageDto,
  type AdminTranslationsDto,
  type CreateLanguageBody,
  type PublicLanguagesDto,
  type PublicMessagesDto,
  type SaveTranslationsBody,
  type SaveTranslationsResultDto,
  type UpdateLanguageBody,
  createLanguageBody,
  saveTranslationsBody,
  updateLanguageBody,
} from '@ap/contracts';
import { type AuthUser, AuthGuard, CurrentUser } from '../common/auth';
import { ZodBody } from '../common/validation';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { I18nService } from './i18n.service';

/** Languages and the admin's texts, read by the web app on every page (no sign-in). */
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  @Get('languages')
  @Header('Cache-Control', 'public, max-age=60')
  languages(): PublicLanguagesDto {
    return { languages: this.i18n.languages() };
  }

  @Get('messages/:lang')
  @Header('Cache-Control', 'public, max-age=60')
  messages(@Param('lang') lang: string): PublicMessagesDto {
    return this.i18n.publicMessages(lang.toLowerCase());
  }
}

/** The platform owner's translation editor. */
@Controller('admin/i18n')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class I18nAdminController {
  constructor(private readonly i18n: I18nService) {}

  @Get('languages')
  languages(): Promise<AdminLanguageDto[]> {
    return this.i18n.adminLanguages();
  }

  @Post('languages')
  create(@ZodBody(createLanguageBody) body: CreateLanguageBody): Promise<AdminLanguageDto> {
    return this.i18n.createLanguage(body);
  }

  @Patch('languages/:code')
  update(
    @Param('code') code: string,
    @ZodBody(updateLanguageBody) body: UpdateLanguageBody,
  ): Promise<AdminLanguageDto> {
    return this.i18n.updateLanguage(code.toLowerCase(), body);
  }

  @Delete('languages/:code')
  @HttpCode(204)
  remove(@Param('code') code: string): Promise<void> {
    return this.i18n.deleteLanguage(code.toLowerCase());
  }

  @Get('languages/:code/texts')
  texts(@Param('code') code: string): Promise<AdminTranslationsDto> {
    return this.i18n.texts(code.toLowerCase());
  }

  @Put('languages/:code/texts')
  save(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZodBody(saveTranslationsBody) body: SaveTranslationsBody,
  ): Promise<SaveTranslationsResultDto> {
    return this.i18n.saveTexts(code.toLowerCase(), body, user.id);
  }
}
