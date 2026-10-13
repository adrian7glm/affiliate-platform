import { describe, expect, it } from 'vitest';
import { brandCss, brandPalette, contrastRatio, safeLogoUrl } from './brandColors';
import { fitLogo } from '@/app/o/settings/logo';

describe('brand palette', () => {
  it('keeps the exact color on buttons with readable text', () => {
    const palette = brandPalette('#0F766E')!;
    expect(palette.light['--brand']).toBe('#0f766e');
    expect(contrastRatio(palette.light['--brand'], palette.light['--on-brand'])).toBeGreaterThan(
      4.5,
    );
  });

  it.each(['#facc15', '#ffffff', '#0369a1', '#1e293b', '#000000', '#7c3aed'])(
    'keeps text readable in light and dark mode for %s',
    (color) => {
      const { light, dark } = brandPalette(color)!;
      for (const surface of ['#ffffff', '#f4f6f8']) {
        expect(contrastRatio(light['--brand-strong'], surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(light['--brand-soft-fg'], light['--brand-soft'])).toBeGreaterThanOrEqual(
        4.5,
      );
      for (const surface of ['#131c2e', '#0b1220']) {
        expect(contrastRatio(dark['--brand-strong'], surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(dark['--brand'], surface)).toBeGreaterThanOrEqual(3);
      }
      expect(contrastRatio(dark['--brand'], dark['--on-brand'])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark['--brand-soft-fg'], dark['--brand-soft'])).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it('ignores anything that is not a hex color', () => {
    expect(brandPalette('red')).toBeNull();
    expect(brandPalette('#12}body{')).toBeNull();
    expect(brandCss('.x', 'url(evil)')).toBeNull();
    expect(brandCss('.x', '#123456')).toMatch(/^\.x\{--brand:#123456;.*prefers-color-scheme: dark/);
  });
});

describe('logos', () => {
  it('accepts https and inline raster images only', () => {
    expect(safeLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(safeLogoUrl('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    expect(safeLogoUrl('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(safeLogoUrl('http://example.com/logo.png')).toBeNull();
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull();
    expect(safeLogoUrl(null)).toBeNull();
  });

  it('fits logos in 480x160 without enlarging them', () => {
    expect(fitLogo(2000, 500)).toEqual({ width: 480, height: 120 });
    expect(fitLogo(600, 600)).toEqual({ width: 160, height: 160 });
    expect(fitLogo(200, 80)).toEqual({ width: 200, height: 80 });
  });
});
