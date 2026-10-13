import { parseHex, readableTextOn } from './links';

/**
 * Turns an operator's brand color into the theme variables of the customer pages. Buttons keep
 * the exact color (with black or white text, whichever reads better). Links and other brand text
 * get a darker shade in light mode and a lighter one in dark mode until they reach 4.5:1 contrast,
 * so even a pale yellow or a navy brand stays readable.
 */

export type BrandVars = Record<
  '--brand' | '--brand-strong' | '--on-brand' | '--brand-soft' | '--brand-soft-fg' | '--focus',
  string
>;

export interface BrandPalette {
  light: BrandVars;
  dark: BrandVars;
}

// Page surfaces from globals.css.
const LIGHT_SURFACES = ['#ffffff', '#f4f6f8'];
const DARK_SURFACES = ['#131c2e', '#0b1220'];

type Rgb = [number, number, number];

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(parseHex(a)!);
  const lb = luminance(parseHex(b)!);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as Rgb;
}

/** Moves the color toward `target` in small steps until it contrasts enough with every surface. */
function shadeFor(color: Rgb, target: Rgb, surfaces: string[], ratio: number): string {
  for (let step = 0; step <= 20; step++) {
    const hex = toHex(mix(color, target, step / 20));
    if (surfaces.every((s) => contrastRatio(hex, s) >= ratio)) return hex;
  }
  return toHex(target);
}

/** Null when the color is not a valid hex color. */
export function brandPalette(color: string | null | undefined): BrandPalette | null {
  const rgb = color ? parseHex(color) : null;
  if (!rgb) return null;
  const hex = toHex(rgb);
  const black: Rgb = [0, 0, 0];
  const white: Rgb = [255, 255, 255];

  const lightStrong = shadeFor(rgb, black, LIGHT_SURFACES, 4.5);
  const lightSoft = toHex(mix(rgb, white, 0.86));
  const light: BrandVars = {
    '--brand': hex,
    '--brand-strong': lightStrong,
    '--on-brand': readableTextOn(hex),
    '--brand-soft': lightSoft,
    '--brand-soft-fg': shadeFor(rgb, black, [lightSoft], 4.5),
    '--focus': shadeFor(rgb, black, LIGHT_SURFACES, 3),
  };

  // In dark mode a very dark brand would disappear: lift it until it stands out as a button.
  const darkBrand = shadeFor(rgb, white, DARK_SURFACES, 3);
  const darkSoft = toHex(mix(rgb, parseHex(DARK_SURFACES[0]!)!, 0.78));
  const dark: BrandVars = {
    '--brand': darkBrand,
    '--brand-strong': shadeFor(rgb, white, DARK_SURFACES, 4.5),
    '--on-brand': readableTextOn(darkBrand),
    '--brand-soft': darkSoft,
    '--brand-soft-fg': shadeFor(rgb, white, [darkSoft], 4.5),
    '--focus': darkBrand,
  };
  return { light, dark };
}

function declarations(vars: BrandVars): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/**
 * CSS that re-brands every element matching `selector`, in light and dark mode. The values come
 * from brandPalette, so they are always plain hex colors (safe to inline in a <style>).
 */
export function brandCss(selector: string, color: string | null | undefined): string | null {
  const palette = brandPalette(color);
  if (!palette) return null;
  return (
    `${selector}{${declarations(palette.light)}}` +
    `@media (prefers-color-scheme: dark){${selector}{${declarations(palette.dark)}}}`
  );
}

/** Logos shown on customer pages: https addresses or inline raster images only. */
export function safeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\/[^\s"'<>]+$/.test(url)) return url;
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(url)) return url;
  return null;
}
