import { z } from 'zod';

/**
 * Contract for translations: the languages the platform offers and the texts the platform
 * admin changed from the admin area (layered on top of the language files in @ap/i18n).
 */

export const LANG_CODE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const langCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(LANG_CODE, 'use a language code such as de, fr or pt-br');

export interface LanguageInfoDto {
  code: string;
  /** Name in the language itself ("Deutsch"). */
  name: string;
  /** Name in English ("German"). */
  englishName: string;
}

/** GET /i18n/languages: languages people can pick, in display order. */
export interface PublicLanguagesDto {
  languages: LanguageInfoDto[];
}

/** GET /i18n/messages/:lang: the admin's texts for one language, flat keys. */
export interface PublicMessagesDto {
  lang: string;
  /** Changes whenever a text of this language changes. */
  version: string;
  messages: Record<string, string>;
}

export interface AdminLanguageDto extends LanguageInfoDto {
  enabled: boolean;
  /** Ships with the platform as a JSON file (cannot be deleted). */
  bundled: boolean;
  /** Texts translated (file or admin) out of `total`. */
  translated: number;
  total: number;
  /** Texts changed from the admin area. */
  overrides: number;
}

export const createLanguageBody = z.object({
  code: langCode,
  name: z.string().trim().min(1).max(60),
  englishName: z.string().trim().min(1).max(60),
});
export type CreateLanguageBody = z.infer<typeof createLanguageBody>;

export const updateLanguageBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    englishName: z.string().trim().min(1).max(60),
    enabled: z.boolean(),
  })
  .partial();
export type UpdateLanguageBody = z.infer<typeof updateLanguageBody>;

export interface TranslationEntryDto {
  /** Flat key; plural forms have their suffix ("public.seatsLeft_few"). */
  key: string;
  /** English text, for the translator. */
  reference: string;
  /** Text from the language file, if any. */
  file: string | null;
  /** Text set from the admin area, if any (wins over the file). */
  override: string | null;
}

/** GET /admin/i18n/languages/:code/texts */
export interface AdminTranslationsDto {
  language: AdminLanguageDto;
  entries: TranslationEntryDto[];
}

/** Text per key; null or "" removes the admin's text, so the file text applies again. */
export const saveTranslationsBody = z.object({
  values: z.record(z.string().max(200), z.string().max(4000).nullable()),
});
export type SaveTranslationsBody = z.infer<typeof saveTranslationsBody>;

export interface TranslationIssueDto {
  key: string;
  problem: 'unknown_key' | 'missing_placeholder' | 'unknown_placeholder' | 'too_long' | 'empty';
  names?: string[];
}

export interface SaveTranslationsResultDto {
  saved: number;
  removed: number;
  /** Texts that were not saved, and why. */
  rejected: TranslationIssueDto[];
  language: AdminLanguageDto;
}
