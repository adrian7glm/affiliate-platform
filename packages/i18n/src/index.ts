import { LOCALE_FILES } from './catalog';
import type reference from './locales/en.json';

/**
 * Translations for every surface of the platform: web screens, emails, SMS, tickets and API
 * error messages. Each language is one JSON file in `src/locales` (`en.json` is the reference
 * and must hold every key); the platform admin can override any text, or add a language,
 * from the admin area, and those overrides are layered on top of the files.
 *
 * Message syntax: `{name}` is replaced by a variable. A message with a count has one key per
 * plural form of the language (`seats_one`, `seats_few`, `seats_other`; see Intl.PluralRules),
 * and is looked up as `seats` with `{ count }`.
 */

type Tree = { [key: string]: string | Tree };
export type Messages = Readonly<Record<string, string>>;
export type Vars = Readonly<Record<string, string | number>>;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
type PluralForm = (typeof PLURAL_FORMS)[number];
type WithoutPlural<K> = K extends `${infer Base}_${PluralForm}` ? Base : K;

/** Every message key, plural keys without their `_one`/`_other` suffix. */
export type MessageKey = Exclude<WithoutPlural<Leaves<typeof reference>>, `$language.${string}`>;

export interface LanguageInfo {
  /** Lowercase BCP 47 code: `ro`, `en`, `de`, `pt-br`. */
  code: string;
  /** Name in the language itself: "Română", "Deutsch". */
  name: string;
  /** Name in English, for the admin area. */
  englishName: string;
}

/** The language every other language falls back to for a missing text. */
export const REFERENCE_LANG = 'en';
export const LANG_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

const files = LOCALE_FILES as unknown as Record<string, Tree>;

/** Languages that ship with the platform as JSON files. */
export const BUNDLED_LANGS: readonly string[] = Object.keys(files).sort((a, b) =>
  a === REFERENCE_LANG ? 1 : b === REFERENCE_LANG ? -1 : a.localeCompare(b),
);

export function isBundled(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(files, code);
}

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`. */
export function flatten(tree: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tree || typeof tree !== 'object') return out;
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (value && typeof value === 'object') Object.assign(out, flatten(value, path));
  }
  return out;
}

/** `{ "a.b": "x" }` → `{ a: { b: "x" } }`, keys sorted as in the reference file. */
export function unflatten(flat: Readonly<Record<string, string>>): Tree {
  const out: Tree = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next === 'object') node = next;
      else node = node[part] = {};
    }
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

const flatCache = new Map<string, Messages>();

/** The texts of a bundled language file, flattened, without its `$language` header. */
export function bundledMessages(code: string): Messages {
  let cached = flatCache.get(code);
  if (!cached) {
    const tree = isBundled(code) ? { ...files[code]! } : {};
    delete tree.$language;
    cached = Object.freeze(flatten(tree));
    flatCache.set(code, cached);
  }
  return cached;
}

/** Every key of the reference language, plural forms included (`seats_one`, `seats_other`). */
export function referenceKeys(): string[] {
  return Object.keys(bundledMessages(REFERENCE_LANG));
}

export function bundledLanguage(code: string): LanguageInfo | null {
  if (!isBundled(code)) return null;
  const header = (files[code]!.$language ?? {}) as Partial<Record<'name' | 'englishName', string>>;
  return { code, name: header.name ?? code, englishName: header.englishName ?? code };
}

export function bundledLanguages(): LanguageInfo[] {
  return BUNDLED_LANGS.map((code) => bundledLanguage(code)!);
}

/** Lowercase BCP 47 with hyphens: "pt_BR" → "pt-br". */
export function normalizeLangTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * The best available language for a BCP 47 tag: exact match ("pt-br"), then the base language
 * ("de-AT" → "de"). Moldovan ("mo") is Romanian.
 */
export function matchLanguage(
  tag: string | null | undefined,
  available: readonly string[],
): string | null {
  if (!tag) return null;
  const normalized = normalizeLangTag(tag);
  if (!normalized) return null;
  if (available.includes(normalized)) return normalized;
  let base = normalized.split('-')[0]!;
  if (base === 'mo') base = 'ro';
  if (available.includes(base)) return base;
  return available.find((code) => code.split('-')[0] === base) ?? null;
}

/** The visitor's most preferred available language from an `Accept-Language` header. */
export function matchAcceptLanguage(
  header: string | null | undefined,
  available: readonly string[],
): string | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag?.trim() ?? '', q: q ? Number(q.trim().slice(2)) : 1, index };
    })
    .filter((t) => t.tag && t.tag !== '*' && !Number.isNaN(t.q) && t.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of tags) {
    const match = matchLanguage(tag, available);
    if (match) return match;
  }
  return null;
}

/** Locale for Intl and date formatting in a UI language. */
export function intlLocale(lang: string): string {
  if (lang === 'ro') return 'ro-RO';
  if (lang === 'en') return 'en-GB';
  try {
    return Intl.getCanonicalLocales(lang)[0] ?? 'en-GB';
  } catch {
    return 'en-GB';
  }
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Variable names used by a message: "Pay {amount} by {date}" → ["amount", "date"]. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))].sort();
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(PLACEHOLDER, (match, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

/** The key a stored text belongs to: "public.seats_few" → "public.seats". */
export function baseKey(key: string): string {
  const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return match ? match[1]! : key;
}

/** Plural forms a language uses, e.g. Romanian: one, few, other. */
export function pluralForms(lang: string): PluralForm[] {
  try {
    const used = new Intl.PluralRules(intlLocale(lang)).resolvedOptions().pluralCategories;
    return PLURAL_FORMS.filter((form) => used.includes(form));
  } catch {
    return ['one', 'other'];
  }
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralForm(lang: string, count: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(intlLocale(lang));
    } catch {
      rules = new Intl.PluralRules('en');
    }
    pluralRules.set(lang, rules);
  }
  return rules.select(count);
}

/** One source of texts, in one language (the language decides plural forms). */
export interface Layer {
  lang: string;
  messages: Messages;
}

function lookup(layers: readonly Layer[], key: string, count: number | undefined): string | null {
  for (const { lang, messages } of layers) {
    if (count !== undefined) {
      const form = messages[`${key}_${pluralForm(lang, count)}`] ?? messages[`${key}_other`];
      if (form !== undefined) return form;
    }
    const plain = messages[key];
    if (plain !== undefined) return plain;
  }
  return null;
}

/**
 * Layers to translate into `lang`: the admin's overrides first, then the language file, then
 * the base language file ("pt" for "pt-br"), then English.
 */
export function layersFor(
  lang: string,
  overrides: Readonly<Record<string, Messages>> = {},
): Layer[] {
  const chain = [lang];
  const base = lang.split('-')[0]!;
  if (base !== lang) chain.push(base);
  if (!chain.includes(REFERENCE_LANG)) chain.push(REFERENCE_LANG);
  const layers: Layer[] = [];
  for (const code of chain) {
    const custom = overrides[code];
    if (custom && Object.keys(custom).length) layers.push({ lang: code, messages: custom });
    if (isBundled(code)) layers.push({ lang: code, messages: bundledMessages(code) });
  }
  return layers;
}

export interface Translator {
  lang: string;
  /** Translated text; a missing key comes back as the key itself, so it shows up in review. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Same as `t` for keys that are only known at run time (statuses, error codes). */
  tk: (key: string, vars?: Vars) => string;
  has: (key: string) => boolean;
}

export function createTranslator(
  lang: string,
  overrides: Readonly<Record<string, Messages>> = {},
): Translator {
  const layers = layersFor(lang, overrides);
  const tk = (key: string, vars?: Vars) => {
    const count = typeof vars?.count === 'number' ? vars.count : undefined;
    const template = lookup(layers, key, count);
    return template === null ? key : interpolate(template, vars);
  };
  return {
    lang,
    t: tk,
    tk,
    has: (key) => lookup(layers, key, 0) !== null || lookup(layers, key, undefined) !== null,
  };
}

export interface TranslationIssue {
  key: string;
  problem: 'unknown_key' | 'missing_placeholder' | 'unknown_placeholder' | 'too_long' | 'empty';
  /** The placeholder names involved. */
  names?: string[];
}

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Checks a translated text against the reference: the key must exist (a plural form of a
 * plural key is accepted) and it can only use the variables the reference text uses.
 * Leaving a variable out is allowed for plural forms ("one seat left" has no {count}).
 */
export function checkTranslation(key: string, value: string): TranslationIssue | null {
  const reference = bundledMessages(REFERENCE_LANG);
  const base = baseKey(key);
  const isPluralForm = base !== key;
  const referenceText =
    reference[key] ?? (isPluralForm ? (reference[`${base}_other`] ?? null) : null);
  if (referenceText === null) return { key, problem: 'unknown_key' };
  if (!value.trim()) return { key, problem: 'empty' };
  if (value.length > MAX_MESSAGE_LENGTH) return { key, problem: 'too_long' };
  const allowed = new Set(
    isPluralForm
      ? Object.entries(reference)
          .filter(([k]) => baseKey(k) === base)
          .flatMap(([, text]) => placeholders(text))
      : placeholders(referenceText),
  );
  const used = placeholders(value);
  const unknown = used.filter((name) => !allowed.has(name));
  if (unknown.length) return { key, problem: 'unknown_placeholder', names: unknown };
  if (!isPluralForm) {
    const missing = [...allowed].filter((name) => !used.includes(name));
    if (missing.length) return { key, problem: 'missing_placeholder', names: missing };
  }
  return null;
}
