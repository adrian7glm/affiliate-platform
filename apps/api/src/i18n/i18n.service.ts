import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  BUNDLED_LANGS,
  REFERENCE_LANG,
  baseKey,
  bundledLanguage,
  bundledMessages,
  checkTranslation,
  createTranslator,
  matchAcceptLanguage,
  pluralForms,
  referenceKeys,
  type LanguageInfo,
  type Messages,
  type Translator,
} from '@ap/i18n';
import type {
  AdminLanguageDto,
  AdminTranslationsDto,
  CreateLanguageBody,
  SaveTranslationsBody,
  SaveTranslationsResultDto,
  TranslationIssueDto,
  UpdateLanguageBody,
} from '@ap/contracts';
import { type Database, languages, translations } from '@ap/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { Request } from 'express';
import { DomainError, NotFound, type ErrorTranslator, type ErrorVars } from '../common/errors';
import { DB } from '../database/database.module';

type LanguageRow = typeof languages.$inferSelect;

interface Snapshot {
  rows: Map<string, LanguageRow>;
  overrides: Record<string, Messages>;
  versions: Record<string, string>;
  loadedAt: number;
}

/** Overrides are re-read this often, so every API instance picks up the admin's changes. */
const REFRESH_MS = 30_000;
/** Shown first in the language picker; the rest follow by English name. */
const FIRST = ['ro', 'en'];

/**
 * Texts in the platform's languages: the language files of @ap/i18n plus what the platform
 * admin changed or added from the admin area (tables `languages` and `translations`).
 * Reads are synchronous from an in-memory copy that is refreshed in the background.
 */
@Injectable()
export class I18nService implements ErrorTranslator, OnModuleInit {
  private readonly logger = new Logger('I18n');
  private snapshot: Snapshot = { rows: new Map(), overrides: {}, versions: {}, loadedAt: 0 };
  private loading: Promise<void> | null = null;
  private translators = new Map<string, Translator>();

  constructor(@Inject(DB) private readonly db: Database) {}

  async onModuleInit(): Promise<void> {
    await this.reload().catch((error) => this.logger.error(`could not load texts: ${error}`));
  }

  /** Re-reads the admin's texts now (after a change) or when the copy is old. */
  async reload(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async load(): Promise<void> {
    const [languageRows, textRows] = await Promise.all([
      this.db.select().from(languages),
      this.db.select().from(translations),
    ]);
    const overrides: Record<string, Record<string, string>> = {};
    const latest: Record<string, number> = {};
    for (const row of textRows) {
      (overrides[row.lang] ??= {})[row.key] = row.value;
      latest[row.lang] = Math.max(latest[row.lang] ?? 0, row.updatedAt.getTime());
    }
    this.snapshot = {
      rows: new Map(languageRows.map((row) => [row.code, row])),
      overrides,
      versions: Object.fromEntries(
        Object.entries(latest).map(([lang, time]) => [
          lang,
          `${time.toString(36)}-${Object.keys(overrides[lang] ?? {}).length}`,
        ]),
      ),
      loadedAt: Date.now(),
    };
    this.translators.clear();
  }

  private current(): Snapshot {
    if (Date.now() - this.snapshot.loadedAt > REFRESH_MS) {
      void this.reload().catch((error) => this.logger.warn(`could not refresh texts: ${error}`));
    }
    return this.snapshot;
  }

  private info(code: string, snap: Snapshot): (LanguageInfo & { enabled: boolean }) | null {
    const row = snap.rows.get(code);
    const file = bundledLanguage(code);
    if (!row && !file) return null;
    return {
      code,
      name: row?.name ?? file!.name,
      englishName: row?.englishName ?? file!.englishName,
      enabled: row?.enabled ?? true,
    };
  }

  private allCodes(snap: Snapshot): string[] {
    const codes = new Set([...BUNDLED_LANGS, ...snap.rows.keys()]);
    return [...codes].sort((a, b) => {
      const ia = FIRST.indexOf(a);
      const ib = FIRST.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return (this.info(a, snap)?.englishName ?? a).localeCompare(
        this.info(b, snap)?.englishName ?? b,
      );
    });
  }

  /** Languages people can pick, in display order. */
  languages(): LanguageInfo[] {
    const snap = this.current();
    return this.allCodes(snap)
      .map((code) => this.info(code, snap)!)
      .filter((l) => l.enabled)
      .map(({ code, name, englishName }) => ({ code, name, englishName }));
  }

  available(): string[] {
    return this.languages().map((l) => l.code);
  }

  /** The best offered language for a language tag or an Accept-Language header. */
  pick(header: string | null | undefined, fallback = REFERENCE_LANG): string {
    return matchAcceptLanguage(header, this.available()) ?? fallback;
  }

  langOf(request: Request): string {
    return this.pick(request.headers['accept-language']);
  }

  /** Translator with the admin's texts first, then the language files. */
  translator(lang: string): Translator {
    const snap = this.current();
    let translator = this.translators.get(lang);
    if (!translator) {
      translator = createTranslator(lang, snap.overrides);
      this.translators.set(lang, translator);
    }
    return translator;
  }

  translate(lang: string, code: string, vars?: ErrorVars): string {
    return this.translator(lang).tk(code, vars);
  }

  /** The admin's texts for one language, for the web app to layer on its bundled files. */
  publicMessages(lang: string): { lang: string; version: string; messages: Messages } {
    const snap = this.current();
    const info = this.info(lang, snap);
    if (!info?.enabled) throw new NotFound('language');
    return { lang, version: snap.versions[lang] ?? '0', messages: snap.overrides[lang] ?? {} };
  }

  // -------------------------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------------------------

  /** Keys a translator fills for a language: plural keys get that language's plural forms. */
  private editableKeys(lang: string): { key: string; reference: string }[] {
    const reference = bundledMessages(REFERENCE_LANG);
    const seen = new Set<string>();
    const out: { key: string; reference: string }[] = [];
    for (const key of referenceKeys()) {
      const base = baseKey(key);
      if (base === key) {
        out.push({ key, reference: reference[key]! });
        continue;
      }
      if (seen.has(base)) continue;
      seen.add(base);
      for (const form of pluralForms(lang)) {
        out.push({
          key: `${base}_${form}`,
          reference: reference[`${base}_${form}`] ?? reference[`${base}_other`]!,
        });
      }
    }
    return out;
  }

  private adminLanguage(code: string, snap: Snapshot): AdminLanguageDto {
    const info = this.info(code, snap);
    if (!info) throw new NotFound('language');
    const file = bundledMessages(code);
    const custom = snap.overrides[code] ?? {};
    const keys = this.editableKeys(code);
    return {
      ...info,
      bundled: BUNDLED_LANGS.includes(code),
      total: keys.length,
      translated: keys.filter(({ key }) => custom[key] ?? file[key]).length,
      overrides: Object.keys(custom).length,
    };
  }

  async adminLanguages(): Promise<AdminLanguageDto[]> {
    await this.reload();
    const snap = this.snapshot;
    return this.allCodes(snap).map((code) => this.adminLanguage(code, snap));
  }

  async createLanguage(body: CreateLanguageBody): Promise<AdminLanguageDto> {
    await this.reload();
    if (this.info(body.code, this.snapshot)) {
      throw new DomainError('errors.i18n.languageExists', HttpStatus.CONFLICT, undefined, {
        code: body.code,
      });
    }
    await this.db.insert(languages).values({
      code: body.code,
      name: body.name,
      englishName: body.englishName,
      // A new language stays hidden until it is translated and switched on.
      enabled: false,
    });
    await this.reload();
    return this.adminLanguage(body.code, this.snapshot);
  }

  async updateLanguage(code: string, body: UpdateLanguageBody): Promise<AdminLanguageDto> {
    await this.reload();
    const info = this.info(code, this.snapshot);
    if (!info) throw new NotFound('language');
    if (body.enabled === false && code === REFERENCE_LANG) {
      throw new DomainError('errors.i18n.referenceRequired', HttpStatus.BAD_REQUEST);
    }
    await this.db
      .insert(languages)
      .values({
        code,
        name: body.name ?? info.name,
        englishName: body.englishName ?? info.englishName,
        enabled: body.enabled ?? info.enabled,
      })
      .onConflictDoUpdate({
        target: languages.code,
        set: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.englishName !== undefined ? { englishName: body.englishName } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        },
      });
    await this.reload();
    return this.adminLanguage(code, this.snapshot);
  }

  /** Removes a language added from the admin area, with its texts. */
  async deleteLanguage(code: string): Promise<void> {
    if (BUNDLED_LANGS.includes(code)) {
      throw new DomainError('errors.i18n.bundledLanguage', HttpStatus.BAD_REQUEST);
    }
    const deleted = await this.db.transaction(async (tx) => {
      await tx.delete(translations).where(eq(translations.lang, code));
      return tx.delete(languages).where(eq(languages.code, code)).returning();
    });
    if (!deleted.length) throw new NotFound('language');
    await this.reload();
  }

  async texts(code: string): Promise<AdminTranslationsDto> {
    await this.reload();
    const snap = this.snapshot;
    const language = this.adminLanguage(code, snap);
    const file = bundledMessages(code);
    const custom = snap.overrides[code] ?? {};
    return {
      language,
      entries: this.editableKeys(code).map(({ key, reference }) => ({
        key,
        reference,
        file: file[key] ?? null,
        override: custom[key] ?? null,
      })),
    };
  }

  async saveTexts(
    code: string,
    body: SaveTranslationsBody,
    userId: string,
  ): Promise<SaveTranslationsResultDto> {
    await this.reload();
    if (!this.info(code, this.snapshot)) throw new NotFound('language');
    const file = bundledMessages(code);
    const rejected: TranslationIssueDto[] = [];
    const upserts: { key: string; value: string }[] = [];
    const removals: string[] = [];
    for (const [key, raw] of Object.entries(body.values)) {
      const value = raw?.replace(/\r\n/g, '\n') ?? null;
      // Empty, or the same as the file: nothing to keep from the admin.
      if (value === null || value.trim() === '' || value === file[key]) {
        if (checkTranslation(key, 'x')?.problem === 'unknown_key') {
          rejected.push({ key, problem: 'unknown_key' });
        } else {
          removals.push(key);
        }
        continue;
      }
      const issue = checkTranslation(key, value);
      if (issue && issue.problem !== 'missing_placeholder') {
        rejected.push(issue);
        continue;
      }
      upserts.push({ key, value });
    }
    await this.db.transaction(async (tx) => {
      if (removals.length) {
        await tx
          .delete(translations)
          .where(and(eq(translations.lang, code), inArray(translations.key, removals)));
      }
      for (const { key, value } of upserts) {
        await tx
          .insert(translations)
          .values({ lang: code, key, value, updatedByUserId: userId })
          .onConflictDoUpdate({
            target: [translations.lang, translations.key],
            set: { value, updatedByUserId: userId, updatedAt: new Date() },
          });
      }
    });
    await this.reload();
    return {
      saved: upserts.length,
      removed: removals.length,
      rejected,
      language: this.adminLanguage(code, this.snapshot),
    };
  }
}
