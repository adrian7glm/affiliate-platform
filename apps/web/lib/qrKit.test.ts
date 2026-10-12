import { describe, expect, it } from 'vitest';
import { getT } from './i18n';
import {
  DEFAULT_KIT_COLOR,
  KIT_FORMATS,
  displayUrl,
  fitText,
  kitFormat,
  kitFormatTexts,
  kitPrintTexts,
  normalizeColor,
  textOn,
} from './qrKit';

// Every character is `size` wide: easy to reason about.
const measure = (text: string, size: number) => text.length * size;

describe('fitText', () => {
  it('keeps the largest size that fits on one line', () => {
    expect(fitText(measure, 'Delta', 100, 10, 5, 1)).toEqual({ lines: ['Delta'], size: 10 });
  });

  it('wraps before shrinking when more lines are allowed', () => {
    expect(fitText(measure, 'Plimbare cu barca', 90, 10, 5, 2)).toEqual({
      lines: ['Plimbare', 'cu barca'],
      size: 10,
    });
  });

  it('shrinks, then cuts with an ellipsis', () => {
    const shrunk = fitText(measure, 'Plimbare', 60, 10, 5, 1);
    expect(shrunk.lines).toEqual(['Plimbare']);
    expect(shrunk.size).toBeLessThanOrEqual(7.5);

    const cut = fitText(measure, 'Plimbare la apus pe Dunăre', 40, 10, 5, 1);
    expect(cut.size).toBe(5);
    expect(cut.lines).toHaveLength(1);
    expect(cut.lines[0]!.endsWith('…')).toBe(true);
    expect(measure(cut.lines[0]!, 5)).toBeLessThanOrEqual(40);
  });
});

describe('colors', () => {
  it('accepts #rgb and #rrggbb, defaults otherwise', () => {
    expect(normalizeColor('#0A7')).toBe('#00aa77');
    expect(normalizeColor('#FF5500')).toBe('#ff5500');
    expect(normalizeColor('red')).toBe(DEFAULT_KIT_COLOR);
    expect(normalizeColor(undefined)).toBe(DEFAULT_KIT_COLOR);
  });

  it('picks readable text on the brand color', () => {
    expect(textOn('#0369a1')).toBe('#ffffff');
    expect(textOn('#fde047')).toBe('#0b1726');
  });
});

describe('formats', () => {
  it('tiles every page exactly with its panels', () => {
    for (const spec of KIT_FORMATS) {
      const area = spec.panels.reduce((sum, p) => sum + p.w * p.h, 0);
      expect(area).toBeCloseTo(spec.page.w * spec.page.h, 6);
      for (const p of spec.panels) {
        expect(p.x + p.w).toBeLessThanOrEqual(spec.page.w + 1e-9);
        expect(p.y + p.h).toBeLessThanOrEqual(spec.page.h + 1e-9);
      }
    }
  });

  it('turns the back of the table tent upside down', () => {
    expect(kitFormat('tent').panels.map((p) => !!p.flipped)).toEqual([true, false]);
  });

  it('falls back to the A4 poster', () => {
    expect(kitFormat('nope').id).toBe('poster-a4');
  });
});

describe('displayUrl', () => {
  it('drops the scheme', () => {
    expect(displayUrl('https://go.example.com/r/ABC1234')).toBe('go.example.com/r/ABC1234');
  });
});

describe('kit texts', () => {
  it('names every format in each language', () => {
    for (const lang of ['ro', 'en']) {
      const t = getT(lang);
      for (const spec of KIT_FORMATS) {
        const texts = kitFormatTexts(spec, t);
        for (const text of Object.values(texts)) {
          expect(text).not.toMatch(/^kit\./);
          expect(text.length).toBeGreaterThan(0);
        }
      }
    }
    expect(kitFormatTexts(kitFormat('tent'), getT('ro')).label).toBe('Cort de masă');
    expect(kitFormatTexts(kitFormat('tent'), getT('en')).label).toBe('Table tent');
  });

  it('prints the call to action in the chosen language', () => {
    expect(kitPrintTexts(getT('ro')).headline).toBe('Scanează și rezervă');
    expect(kitPrintTexts(getT('en')).headline).toBe('Scan & book');
  });
});
