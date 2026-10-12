import { flatten, unflatten } from '@ap/i18n';
import type { AdminLanguageDto, TranslationEntryDto } from '@ap/contracts';

/** Language files for download and upload, in the format of packages/i18n/src/locales/*.json. */

/** The texts of a language (file + admin changes) as a nested JSON file. */
export function languageFile(language: AdminLanguageDto, entries: TranslationEntryDto[]): string {
  const flat: Record<string, string> = {};
  for (const entry of entries) {
    const value = entry.override ?? entry.file;
    if (value) flat[entry.key] = value;
  }
  const file = {
    $language: { name: language.name, englishName: language.englishName },
    ...unflatten(flat),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function downloadFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Flat texts of an uploaded language file; throws on invalid JSON. */
export function parseLanguageFile(text: string): Record<string, string> {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('not a JSON object');
  }
  const { $language: _header, ...texts } = parsed as Record<string, unknown>;
  return flatten(texts);
}
