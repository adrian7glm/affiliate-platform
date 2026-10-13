import { describe, expect, it } from 'vitest';
import {
  BUNDLED_LANGS,
  REFERENCE_LANG,
  baseKey,
  bundledLanguage,
  bundledMessages,
  placeholders,
  pluralForms,
} from './index';

/** Languages that must be complete: the platform ships with them. */
const COMPLETE = ['ro', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'uk'];
const reference = bundledMessages(REFERENCE_LANG);
const referenceBases = new Set(Object.keys(reference).map(baseKey));
const pluralBases = new Set(
  Object.keys(reference)
    .filter((k) => baseKey(k) !== k)
    .map(baseKey),
);

describe.each(BUNDLED_LANGS)('%s.json', (lang) => {
  const messages = bundledMessages(lang);

  it('names itself', () => {
    const info = bundledLanguage(lang)!;
    expect(info.name).not.toBe(lang);
    expect(info.englishName).not.toBe(lang);
  });

  it('has only keys that exist in en.json', () => {
    const unknown = Object.keys(messages).filter((k) => !referenceBases.has(baseKey(k)));
    expect(unknown).toEqual([]);
  });

  it('uses the same variables as en.json', () => {
    const wrong = Object.entries(messages).flatMap(([key, text]) => {
      const base = baseKey(key);
      const allowed = new Set(
        Object.entries(reference)
          .filter(([k]) => baseKey(k) === base)
          .flatMap(([, t]) => placeholders(t)),
      );
      const bad = placeholders(text).filter((name) => !allowed.has(name));
      return bad.length ? [`${key}: {${bad.join('}, {')}}`] : [];
    });
    expect(wrong).toEqual([]);
  });

  it('has no empty texts', () => {
    expect(Object.entries(messages).filter(([, v]) => !v.trim())).toEqual([]);
  });

  if (COMPLETE.includes(lang)) {
    it('translates every text', () => {
      const plain = Object.keys(reference).filter((k) => baseKey(k) === k);
      expect(plain.filter((k) => messages[k] === undefined)).toEqual([]);
    });

    it('has every plural form of the language', () => {
      const forms = pluralForms(lang);
      const missing = [...pluralBases].flatMap((base) =>
        forms.filter((f) => messages[`${base}_${f}`] === undefined).map((f) => `${base}_${f}`),
      );
      expect(missing).toEqual([]);
    });
  }
});
