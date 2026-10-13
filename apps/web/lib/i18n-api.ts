import type {
  AdminLanguageDto,
  AdminTranslationsDto,
  CreateLanguageBody,
  PublicLanguagesDto,
  PublicMessagesDto,
  SaveTranslationsBody,
  SaveTranslationsResultDto,
  UpdateLanguageBody,
} from '@ap/contracts';
import { apiFetch, type RequestOptions } from './api';

export type PublicLanguages = PublicLanguagesDto;
export type PublicMessages = PublicMessagesDto;

type Opts = Pick<RequestOptions, 'signal' | 'baseUrl'>;
const enc = encodeURIComponent;

/** Languages and the admin's text overrides (public), and the translation editor (admin). */
export const i18nApi = {
  languages: (o?: Opts) => apiFetch<PublicLanguagesDto>('/i18n/languages', { ...o, auth: false }),
  messages: (lang: string, o?: Opts) =>
    apiFetch<PublicMessagesDto>(`/i18n/messages/${enc(lang)}`, { ...o, auth: false }),
};

export const translationsAdminApi = {
  languages: (o?: Opts) => apiFetch<AdminLanguageDto[]>('/admin/i18n/languages', o),
  createLanguage: (body: CreateLanguageBody) =>
    apiFetch<AdminLanguageDto>('/admin/i18n/languages', { method: 'POST', body }),
  updateLanguage: (code: string, body: UpdateLanguageBody) =>
    apiFetch<AdminLanguageDto>(`/admin/i18n/languages/${enc(code)}`, { method: 'PATCH', body }),
  deleteLanguage: (code: string) =>
    apiFetch<void>(`/admin/i18n/languages/${enc(code)}`, { method: 'DELETE' }),
  texts: (code: string, o?: Opts) =>
    apiFetch<AdminTranslationsDto>(`/admin/i18n/languages/${enc(code)}/texts`, o),
  save: (code: string, body: SaveTranslationsBody) =>
    apiFetch<SaveTranslationsResultDto>(`/admin/i18n/languages/${enc(code)}/texts`, {
      method: 'PUT',
      body,
    }),
};
