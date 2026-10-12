import { describe, expect, it } from 'vitest';
import {
  bpsToPercentInput,
  currencyDigits,
  formatBps,
  formatMoney,
  parseMoneyInput,
  percentToBps,
  priceCode,
  slugify,
} from './format';

/** Intl uses narrow/no-break spaces; compare with plain spaces. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('formats minor units in Romanian', () => {
    expect(plain(formatMoney(12050, 'RON', 'ro'))).toBe('120,50 RON');
  });

  it('drops the decimals of whole amounts', () => {
    expect(plain(formatMoney(12000, 'RON', 'ro'))).toBe('120 RON');
  });

  it('formats in English for tourists', () => {
    expect(plain(formatMoney(123450, 'EUR', 'en'))).toBe('€1,234.50');
  });

  it('knows currencies without minor units', () => {
    expect(currencyDigits('JPY')).toBe(0);
    expect(plain(formatMoney(1200, 'JPY', 'en'))).toContain('1,200');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['120', 12000],
    ['120,5', 12050],
    ['120.50', 12050],
    ['1.234,50', 123450],
    ['1,234.50', 123450],
    ['1.234', 123400],
    ['0,5', 50],
    [' 75 ', 7500],
  ])('parses %j', (input, expected) => {
    expect(parseMoneyInput(input, 'RON')).toBe(expected);
  });

  it.each(['', 'abc', '-5', '12a'])('rejects %j', (input) => {
    expect(parseMoneyInput(input, 'RON')).toBeNull();
  });
});

describe('percentages', () => {
  it('converts typed percentages to basis points', () => {
    expect(percentToBps('12,5')).toBe(1250);
    expect(percentToBps('10')).toBe(1000);
    expect(percentToBps('7.25%')).toBe(725);
    expect(percentToBps('101')).toBeNull();
    expect(percentToBps('abc')).toBeNull();
  });

  it('formats basis points', () => {
    expect(plain(formatBps(1250, 'ro'))).toBe('12,5 %');
    expect(formatBps(1000, 'en')).toBe('10%');
    expect(bpsToPercentInput(1250)).toBe('12.5');
  });
});

describe('slugs', () => {
  it('strips diacritics and punctuation', () => {
    expect(slugify('Plimbare cu barca – Delta Dunării')).toBe('plimbare-cu-barca-delta-dunarii');
    expect(slugify('  Ștefan & Țara  ')).toBe('stefan-tara');
  });

  it('builds price codes', () => {
    expect(priceCode('Adult (12+)')).toBe('adult_12');
    expect(priceCode('!!!')).toBe('price');
  });
});
