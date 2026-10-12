import { describe, expect, it } from 'vitest';
import {
  getT,
  langFromAcceptLanguage,
  langFromTag,
  pickLang,
  pluralRo,
  translate,
  translatePlural,
} from './i18n';

describe('language choice', () => {
  it('maps tags to supported languages', () => {
    expect(langFromTag('ro-RO')).toBe('ro');
    expect(langFromTag('en_US')).toBe('en');
    expect(langFromTag('de')).toBeNull();
    expect(langFromTag(undefined)).toBeNull();
  });

  it('uses only the most preferred browser language', () => {
    expect(langFromAcceptLanguage('ro-RO,ro;q=0.9,en;q=0.8')).toBe('ro');
    expect(langFromAcceptLanguage('en;q=0.5,ro;q=0.9')).toBe('ro');
    // A German visitor gets English, not Romanian.
    expect(langFromAcceptLanguage('de-DE,de;q=0.9,ro;q=0.5')).toBeNull();
  });

  it('prefers ?lang, then the browser, then English', () => {
    expect(pickLang('ro', 'en-US')).toBe('ro');
    expect(pickLang(null, 'ro-RO')).toBe('ro');
    expect(pickLang('xx', 'fr-FR')).toBe('en');
  });
});

describe('translations', () => {
  it('interpolates variables', () => {
    expect(translate('en', 'payNow', { amount: '€10' })).toBe('Pay €10');
    expect(translate('ro', 'payNow', { amount: '50 RON' })).toBe('Plătește 50 RON');
  });

  it('uses Romanian plural forms', () => {
    expect(translatePlural('ro', 'seatsLeft', 1)).toBe('1 loc liber');
    expect(translatePlural('ro', 'seatsLeft', 3)).toBe('3 locuri libere');
    expect(translatePlural('ro', 'seatsLeft', 20)).toBe('20 de locuri libere');
    expect(translatePlural('en', 'seatsLeft', 1)).toBe('1 seat left');
    expect(translatePlural('en', 'seatsLeft', 5)).toBe('5 seats left');
  });

  it('binds a language', () => {
    const t = getT('ro');
    expect(t.lang).toBe('ro');
    expect(t.t('book')).toBe('Rezervă');
    expect(t.tp('guestCount', 2)).toBe('2 persoane');
  });

  it('pluralizes Romanian staff screens', () => {
    expect(pluralRo(1, 'vânzare', 'vânzări')).toBe('1 vânzare');
    expect(pluralRo(2, 'vânzare', 'vânzări')).toBe('2 vânzări');
    expect(pluralRo(25, 'vânzare', 'vânzări')).toBe('25 de vânzări');
  });
});
