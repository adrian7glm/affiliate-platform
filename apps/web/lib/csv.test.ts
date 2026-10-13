import { describe, expect, it } from 'vitest';
import { csvEscape, minorToCsvAmount, toCsv } from './csv';
import { translate } from './i18n';

describe('csv', () => {
  it('quotes only when needed', () => {
    expect(csvEscape('Ana')).toBe('Ana');
    expect(csvEscape('Popescu, Ana')).toBe('"Popescu, Ana"');
    expect(csvEscape('Spune "da"')).toBe('"Spune ""da"""');
    expect(csvEscape('linie\nnouă')).toBe('"linie\nnouă"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(42)).toBe('42');
  });

  it('builds rows with CRLF', () => {
    expect(
      toCsv(
        ['Afiliat', 'Suma'],
        [
          ['Ana', '12.50'],
          ['Ion, Jr', '3.00'],
        ],
      ),
    ).toBe('Afiliat,Suma\r\nAna,12.50\r\n"Ion, Jr",3.00');
  });

  it('writes amounts with a dot', () => {
    expect(minorToCsvAmount(12345)).toBe('123.45');
    expect(minorToCsvAmount(500, 0)).toBe('500');
  });

  it('takes column headers from the language files', () => {
    const header = (lang: string) => [
      translate(lang, 'operator.payouts.csvAffiliate'),
      translate(lang, 'operator.payouts.csvAmount'),
    ];
    expect(toCsv(header('ro'), [])).toBe('Afiliat,Suma');
    expect(toCsv(header('en'), [])).toBe('Affiliate,Amount');
  });
});
