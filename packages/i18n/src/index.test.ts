import { describe, expect, it } from 'vitest';
import {
  checkTranslation,
  createTranslator,
  flatten,
  matchAcceptLanguage,
  matchLanguage,
  placeholders,
  pluralForms,
  unflatten,
} from './index';

describe('translator', () => {
  it('interpolates variables and falls back to English', () => {
    const { t } = createTranslator('ro');
    expect(t('public.fromPrice', { price: '50 RON' })).toBe('de la 50 RON');
    const de = createTranslator('de');
    expect(de.t('public.fromPrice', { price: '€5' })).toBe('from €5');
  });

  it('picks the plural form of the language', () => {
    const { t } = createTranslator('ro');
    expect(t('public.seatsLeft', { count: 1 })).toBe('1 loc liber');
    expect(t('public.seatsLeft', { count: 5 })).toBe('5 locuri libere');
    expect(t('public.seatsLeft', { count: 25 })).toBe('25 de locuri libere');
    expect(createTranslator('en').t('public.seatsLeft', { count: 3 })).toBe('3 seats left');
  });

  it('puts the admin overrides first, for languages without a file too', () => {
    const { t } = createTranslator('ro', { ro: { 'public.book': 'Cumpără' } });
    expect(t('public.book')).toBe('Cumpără');
    const de = createTranslator('de', { de: { 'public.book': 'Buchen' } });
    expect(de.t('public.book')).toBe('Buchen');
    expect(de.t('public.noProducts')).toBe('No trips are available right now.');
  });

  it('returns the key for an unknown text', () => {
    expect(createTranslator('ro').tk('nope.missing')).toBe('nope.missing');
  });
});

describe('languages', () => {
  it('matches tags to available languages', () => {
    expect(matchLanguage('ro-RO', ['en', 'ro'])).toBe('ro');
    expect(matchLanguage('mo', ['en', 'ro'])).toBe('ro');
    expect(matchLanguage('pt_BR', ['en', 'pt-br'])).toBe('pt-br');
    expect(matchLanguage('pt-PT', ['en', 'pt-br'])).toBe('pt-br');
    expect(matchLanguage('de', ['en', 'ro'])).toBeNull();
  });

  it('reads Accept-Language in order of preference', () => {
    expect(matchAcceptLanguage('de-DE,de;q=0.9,en;q=0.8', ['ro', 'en'])).toBe('en');
    expect(matchAcceptLanguage('en;q=0.5,ro', ['ro', 'en'])).toBe('ro');
    expect(matchAcceptLanguage('*', ['ro', 'en'])).toBeNull();
  });

  it('knows the plural forms of each language', () => {
    expect(pluralForms('ro')).toEqual(['one', 'few', 'other']);
    expect(pluralForms('en')).toEqual(['one', 'other']);
  });
});

describe('admin checks', () => {
  it('accepts a translation with the same variables', () => {
    expect(checkTranslation('public.fromPrice', 'ab {price}')).toBeNull();
  });
  it('rejects unknown keys and variables', () => {
    expect(checkTranslation('public.nope', 'x')?.problem).toBe('unknown_key');
    expect(checkTranslation('public.fromPrice', 'ab {preis}')).toMatchObject({
      problem: 'unknown_placeholder',
      names: ['preis'],
    });
    expect(checkTranslation('public.fromPrice', 'ab')?.problem).toBe('missing_placeholder');
  });
  it('accepts every plural form of a plural key', () => {
    expect(checkTranslation('public.seatsLeft_few', '{count} locuri')).toBeNull();
    expect(checkTranslation('public.seatsLeft_one', 'un loc')).toBeNull();
  });
  it('round-trips nested files', () => {
    const flat = { 'a.b': 'x', 'a.c.d': 'y', e: 'z' };
    expect(flatten(unflatten(flat))).toEqual(flat);
    expect(placeholders('{b} and {a} and {b}')).toEqual(['a', 'b']);
  });
});
