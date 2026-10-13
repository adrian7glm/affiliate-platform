import { describe, expect, it } from 'vitest';
import {
  LANGS,
  formatDuration,
  getT,
  isLangReady,
  loadLanguage,
  langFromAcceptLanguage,
  langFromTag,
  pickLang,
  translate,
} from './i18n';

describe('language choice', () => {
  it('maps tags to offered languages', () => {
    expect(langFromTag('ro-RO')).toBe('ro');
    expect(langFromTag('en_US')).toBe('en');
    expect(langFromTag('mo')).toBe('ro');
    expect(langFromTag('xx')).toBeNull();
    expect(langFromTag(undefined)).toBeNull();
    expect(langFromTag('de-AT', ['en', 'de'])).toBe('de');
  });

  it('reads the most preferred offered browser language', () => {
    expect(langFromAcceptLanguage('ro-RO,ro;q=0.9,en;q=0.8')).toBe('ro');
    expect(langFromAcceptLanguage('en;q=0.5,ro;q=0.9')).toBe('ro');
    expect(langFromAcceptLanguage('xx-XX,xx;q=0.9')).toBeNull();
  });

  it('prefers ?lang, then the saved choice, then the browser, then the fallback', () => {
    expect(pickLang({ query: 'ro', saved: 'en', browser: 'en-US' })).toBe('ro');
    expect(pickLang({ query: 'xx', saved: 'en', browser: 'ro-RO' })).toBe('en');
    expect(pickLang({ browser: ['xx', 'ro-RO'] }, 'en')).toBe('ro');
    expect(pickLang({ query: 'xx', browser: 'xx-XX' }, 'en')).toBe('en');
    // A fallback that is not offered falls to the first offered language.
    expect(pickLang({ available: ['ro'] }, 'en')).toBe('ro');
  });
});

describe('translations', () => {
  it('looks up namespaced keys and interpolates variables', () => {
    expect(getT('ro').t('public.book')).toBe('Rezervă');
    expect(getT('en').t('public.book')).toBe('Book');
    expect(translate('en', 'public.payNow', { amount: '€10' })).toBe('Pay €10');
    expect(translate('ro', 'public.payNow', { amount: '50 RON' })).toBe('Plătește 50 RON');
  });

  it('picks the plural form of the language', () => {
    const ro = getT('ro');
    expect(ro.t('public.seatsLeft', { count: 1 })).toBe('1 loc liber');
    expect(ro.t('public.seatsLeft', { count: 3 })).toBe('3 locuri libere');
    expect(ro.t('public.seatsLeft', { count: 20 })).toBe('20 de locuri libere');
    expect(ro.tp('ticket.guestCount', 2)).toBe('2 persoane');
    const en = getT('en');
    expect(en.t('public.seatsLeft', { count: 1 })).toBe('1 seat left');
    expect(en.tp('public.seatsLeft', 5)).toBe('5 seats left');
  });

  it('binds a language and its Intl locale', () => {
    const t = getT('ro');
    expect(t.lang).toBe('ro');
    expect(t.locale).toBe('ro-RO');
    expect(t.tk('labels.bookingStatus.confirmed')).toBe(
      getT('ro').t('labels.bookingStatus.confirmed'),
    );
  });

  it("layers the admin's overrides on top of the files", () => {
    const t = getT('ro', { ro: { 'public.book': 'Cumpără' } });
    expect(t.t('public.book')).toBe('Cumpără');
    expect(t.t('public.soldOut')).toBe('Complet');
    // Overrides do not leak into the cached translator.
    expect(getT('ro').t('public.book')).toBe('Rezervă');
  });

  it('formats durations in the language', () => {
    expect(formatDuration(45, 'ro')).toBe('45 min');
    expect(formatDuration(120, 'en')).toBe('2 h');
    expect(formatDuration(90, 'en')).toBe('1 h 30 min');
  });
});

describe('language files', () => {
  it('ships every language, loading all but Romanian and English on demand', async () => {
    expect([...LANGS].sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt', 'ro', 'ru', 'uk']);
    expect(isLangReady('ro')).toBe(true);
    expect(isLangReady('de')).toBe(false);
    expect(getT('de').t('common.retry')).toBe('Try again');
    await loadLanguage('de');
    expect(isLangReady('de')).toBe(true);
    expect(getT('de').t('common.retry')).not.toBe('Try again');
    // Languages added from the admin have no file: their texts come from the API.
    expect(isLangReady('nl')).toBe(true);
  });

  it('uses each language’s plural forms', async () => {
    await Promise.all(LANGS.map(loadLanguage));
    for (const lang of LANGS) {
      const { tp } = getT(lang);
      for (const n of [1, 2, 5, 21, 1000000]) {
        expect(tp('public.seatsLeft', n)).toContain(String(n));
      }
    }
  });
});
