import type { Translator } from '@/lib/i18n';

/** Same limit as MAX_INLINE_LOGO_CHARS in @ap/contracts (kept here to keep zod out of the bundle). */
const MAX_INLINE_LOGO_CHARS = 90_000;

/** Logos are shown at most ~48px high; twice that covers sharp screens. */
const MAX_WIDTH = 480;
const MAX_HEIGHT = 160;

export class LogoError extends Error {}

function loadImage(file: File, t: Translator['t']): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new LogoError(t('catalog.settings.logoErrRead')));
    };
    img.src = url;
  });
}

/** Fits a size inside the logo box, never enlarging. */
export function fitLogo(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Turns any image the phone can open (photo, PNG, SVG) into a small inline image: resized to fit
 * 480×160, re-encoded as WebP (PNG where WebP isn't supported), with transparency kept.
 */
export async function logoDataUrl(file: File, t: Translator['t']): Promise<string> {
  if (!file.type.startsWith('image/')) throw new LogoError(t('catalog.settings.logoErrType'));
  const img = await loadImage(file, t);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new LogoError(t('catalog.settings.logoErrSize'));
  }
  let { width, height } = fitLogo(img.naturalWidth, img.naturalHeight);
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new LogoError(t('catalog.settings.logoErrCanvas'));
    ctx.drawImage(img, 0, 0, width, height);
    for (const quality of [0.9, 0.75]) {
      const url = canvas.toDataURL('image/webp', quality);
      if (url.length <= MAX_INLINE_LOGO_CHARS && /^data:image\/(webp|png);/.test(url)) return url;
    }
    width = Math.round(width * 0.7);
    height = Math.round(height * 0.7);
  }
  throw new LogoError(t('catalog.settings.logoErrComplex'));
}
