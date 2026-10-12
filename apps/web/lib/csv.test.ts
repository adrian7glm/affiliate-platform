import { describe, expect, it } from 'vitest';
import { csvEscape, minorToCsvAmount, toCsv } from './csv';

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
});
