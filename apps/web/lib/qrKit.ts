import { create as createQr } from 'qrcode';

/**
 * Printable QR materials (posters, a table tent, cut-out cards), drawn on a canvas so the
 * preview, the PNG, the PDF and the printout are the same pixels.
 *
 * Everything is laid out in millimetres on the printed page; `renderKitPage` turns that into
 * pixels at the requested resolution.
 */

export type KitFormat = 'poster-a4' | 'poster-a5' | 'tent' | 'cards';

export interface KitPanel {
  /** Position and size on the page, in mm. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Upside down: the back face of a folded table tent. */
  flipped?: boolean;
}

export interface KitFormatSpec {
  id: KitFormat;
  label: string;
  /** What it is for, shown under the label. */
  description: string;
  /** How to print and finish it. */
  howTo: string;
  page: { w: number; h: number };
  panels: KitPanel[];
  /** Dashed fold lines (horizontal, mm from the top). */
  folds?: number[];
  /** Thin cut guides between panels. */
  cutGuides?: boolean;
}

const A4 = { w: 210, h: 297 };

export const KIT_FORMATS: KitFormatSpec[] = [
  {
    id: 'poster-a4',
    label: 'Afiș A4',
    description: 'Pe perete sau la intrare',
    howTo: 'Tipărește pe A4, fără margini dacă imprimanta poate.',
    page: A4,
    panels: [{ x: 0, y: 0, ...A4 }],
  },
  {
    id: 'poster-a5',
    label: 'Afiș A5',
    description: 'Pe tejghea, în ramă sau suport',
    howTo: 'Tipărește pe A5, sau pe A4 cu „Potrivește în pagină”.',
    page: { w: 148, h: 210 },
    panels: [{ x: 0, y: 0, w: 148, h: 210 }],
  },
  {
    id: 'tent',
    label: 'Cort de masă',
    description: 'Stă singur pe recepție, se vede din ambele părți',
    howTo: 'Tipărește pe A4 (ideal carton), pliază pe linia punctată și așază-l pe tejghea.',
    page: A4,
    panels: [
      { x: 0, y: 0, w: 210, h: A4.h / 2, flipped: true },
      { x: 0, y: A4.h / 2, w: 210, h: A4.h / 2 },
    ],
    folds: [A4.h / 2],
  },
  {
    id: 'cards',
    label: 'Cartonașe',
    description: '8 pe o foaie A4, de dat turiștilor',
    howTo: 'Tipărește pe A4 și taie pe liniile gri. Dă câte unul turiștilor interesați.',
    page: A4,
    panels: Array.from({ length: 8 }, (_, i) => ({
      x: (i % 2) * 105,
      y: Math.floor(i / 2) * (A4.h / 4),
      w: 105,
      h: A4.h / 4,
    })),
    cutGuides: true,
  },
];

export function kitFormat(id: string | null | undefined): KitFormatSpec {
  return KIT_FORMATS.find((f) => f.id === id) ?? KIT_FORMATS[0]!;
}

export interface KitContent {
  tenantName: string;
  /** The excursion, or null for a link to all of them. */
  productName: string | null;
  /** E.g. "de la / from 120 RON". */
  priceText: string | null;
  qrUrl: string;
  /** Shown small under the code, for people who type it. */
  displayUrl: string;
  /** Operator brand color (#rrggbb). */
  color: string;
  logo: CanvasImageSource | null;
}

export const DEFAULT_KIT_COLOR = '#0369a1';

/** A usable #rrggbb brand color, or the default. */
export function normalizeColor(value: string | null | undefined): string {
  const hex = value?.trim() ?? '';
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return `#${[...hex.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  }
  return DEFAULT_KIT_COLOR;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white text, whichever reads better on the brand color. */
export function textOn(hex: string): string {
  const l = luminance(normalizeColor(hex));
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onWhite >= onBlack ? '#ffffff' : '#0b1726';
}

/** "affiliate.example.com/r/ABC1234" – the link without the scheme and the QR marker. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Breaks `text` into at most `maxLines` lines that fit `maxWidth`, shrinking the font from
 * `maxSize` down to `minSize`. Past that the last line is cut with an ellipsis.
 */
export function fitText(
  measure: (text: string, size: number) => number,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let size = maxSize;
  for (;;) {
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || measure(candidate, size) <= maxWidth) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    const fits = lines.length <= maxLines && lines.every((l) => measure(l, size) <= maxWidth);
    if (fits) return { lines, size };
    if (size <= minSize) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1] ?? '';
      const cut = lines.length > maxLines || measure(last, size) > maxWidth;
      if (cut) {
        while (last && measure(`${last}…`, size) > maxWidth) last = last.slice(0, -1).trimEnd();
        kept[kept.length - 1] = `${last}…`;
      }
      return { lines: kept, size };
    }
    size = Math.max(minSize, size * 0.92);
  }
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const INK = '#0b1726';
const MUTED = '#4a5565';

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight: number) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function measurer(ctx: Ctx, weight: number) {
  return (text: string, size: number) => {
    font(ctx, size, weight);
    return ctx.measureText(text).width;
  };
}

/** Draws fitted text; returns the height used. `align` is relative to x. */
function drawText(
  ctx: Ctx,
  text: string,
  opts: {
    x: number;
    y: number;
    maxWidth: number;
    size: number;
    minSize?: number;
    maxLines?: number;
    weight?: number;
    color?: string;
    align?: CanvasTextAlign;
    lineHeight?: number;
  },
): number {
  const weight = opts.weight ?? 400;
  const { lines, size } = fitText(
    measurer(ctx, weight),
    text,
    opts.maxWidth,
    opts.size,
    opts.minSize ?? opts.size * 0.6,
    opts.maxLines ?? 1,
  );
  const lineHeight = size * (opts.lineHeight ?? 1.15);
  font(ctx, size, weight);
  ctx.fillStyle = opts.color ?? INK;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, opts.x, opts.y + i * lineHeight));
  return lines.length * lineHeight;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** QR code inside a rounded brand-colored frame, snapped to whole pixels per module. */
function drawQr(ctx: Ctx, value: string, cx: number, cy: number, size: number, color: string) {
  const qr = createQr(value, { errorCorrectionLevel: 'Q' });
  const { size: count, data } = qr.modules;
  const quiet = 3;
  const frame = Math.max(2, size * 0.022);
  const inner = size - frame * 2;
  const module = Math.max(1, Math.floor(inner / (count + quiet * 2)));
  const codePx = module * count;
  const box = codePx + module * quiet * 2 + frame * 2;
  const x0 = Math.round(cx - box / 2);
  const y0 = Math.round(cy - box / 2);

  ctx.fillStyle = color;
  roundRect(ctx, x0, y0, box, box, box * 0.06);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x0 + frame, y0 + frame, box - frame * 2, box - frame * 2, box * 0.045);
  ctx.fill();

  const ox = Math.round(x0 + frame + module * quiet);
  const oy = Math.round(y0 + frame + module * quiet);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (data[row * count + col]) {
        const start = col;
        while (col < count && data[row * count + col]) col++;
        ctx.fillRect(ox + start * module, oy + row * module, (col - start) * module, module);
      } else col++;
    }
  }
  return box;
}

/** The operator's logo on a white tile, or its name, centered in a band. */
function drawBrand(
  ctx: Ctx,
  c: KitContent,
  box: { x: number; y: number; w: number; h: number },
  align: 'center' | 'left',
) {
  const onColor = textOn(c.color);
  if (c.logo) {
    const source = c.logo as { width: number; height: number };
    const ratio = source.width / source.height || 1;
    const pad = box.h * 0.12;
    const maxH = box.h * 0.62;
    const maxW = box.w * 0.6;
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    const tileW = w + pad * 2;
    const tileH = h + pad * 2;
    const tx = align === 'center' ? box.x + (box.w - tileW) / 2 : box.x;
    const ty = box.y + (box.h - tileH) / 2;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, tx, ty, tileW, tileH, tileH * 0.18);
    ctx.fill();
    ctx.drawImage(c.logo, tx + pad, ty + pad, w, h);
    return;
  }
  const size = box.h * 0.36;
  const used = fitText(measurer(ctx, 800), c.tenantName, box.w, size, size * 0.55, 2);
  const height = used.lines.length * used.size * 1.1;
  drawText(ctx, c.tenantName, {
    x: align === 'center' ? box.x + box.w / 2 : box.x,
    y: box.y + (box.h - height) / 2,
    maxWidth: box.w,
    size,
    minSize: size * 0.55,
    maxLines: 2,
    weight: 800,
    color: onColor,
    align,
    lineHeight: 1.1,
  });
}

/** Title under the band: the excursion, or the operator when the logo already shows. */
function titleOf(c: KitContent): string | null {
  return c.productName ?? (c.logo ? c.tenantName : null);
}

function drawPortrait(ctx: Ctx, c: KitContent, w: number, h: number) {
  const pad = w * 0.08;
  const band = h * 0.16;
  ctx.fillStyle = c.color;
  ctx.fillRect(0, 0, w, band);
  drawBrand(ctx, c, { x: pad, y: 0, w: w - pad * 2, h: band }, 'center');

  let y = band + h * 0.03;
  const title = titleOf(c);
  if (title) {
    y += drawText(ctx, title, {
      x: w / 2,
      y,
      maxWidth: w - pad * 2,
      size: w * 0.068,
      maxLines: 2,
      weight: 800,
    });
  }
  if (c.priceText) {
    y +=
      h * 0.006 +
      drawText(ctx, c.priceText, {
        x: w / 2,
        y: y + h * 0.006,
        maxWidth: w - pad * 2,
        size: w * 0.042,
        weight: 600,
        color: MUTED,
      });
  }

  // Text block at the bottom, measured first so the code takes the space left between.
  const headline = w * 0.075;
  const sub = w * 0.045;
  const url = w * 0.03;
  const footer = h * 0.02;
  const bottomBlock = headline * 1.15 + sub * 1.3 + url * 1.6 + footer + h * 0.035;
  const top = y + h * 0.025;
  const bottom = h - bottomBlock;
  const qrSize = Math.min(w * 0.66, bottom - top);
  const qrBox = drawQr(ctx, c.qrUrl, w / 2, (top + bottom) / 2, qrSize, c.color);

  let ty = (top + bottom) / 2 + qrBox / 2 + h * 0.022;
  ty += drawText(ctx, 'Scanează și rezervă', {
    x: w / 2,
    y: ty,
    maxWidth: w - pad * 2,
    size: headline,
    weight: 800,
  });
  ty += drawText(ctx, 'Scan & book online', {
    x: w / 2,
    y: ty + sub * 0.1,
    maxWidth: w - pad * 2,
    size: sub,
    weight: 600,
    color: MUTED,
  });
  drawText(ctx, c.displayUrl, {
    x: w / 2,
    y: h - footer - url * 2.2,
    maxWidth: w - pad * 2,
    size: url,
    color: MUTED,
  });
  ctx.fillStyle = c.color;
  ctx.fillRect(0, h - footer, w, footer);
}

function drawLandscape(ctx: Ctx, c: KitContent, w: number, h: number) {
  const pad = h * 0.08;
  const band = h * 0.22;
  ctx.fillStyle = c.color;
  ctx.fillRect(0, 0, w, band);
  drawBrand(ctx, c, { x: pad, y: 0, w: w * 0.62 - pad, h: band }, 'left');

  const qrSize = Math.min(w * 0.4, h - band - pad * 1.6);
  const qrCx = w - pad - qrSize / 2;
  const qrCy = band + (h - band) / 2;
  drawQr(ctx, c.qrUrl, qrCx, qrCy, qrSize, c.color);

  const colW = w - qrSize - pad * 3;
  const title = titleOf(c);
  const titleSize = h * 0.085;
  const headline = h * 0.105;
  const sub = h * 0.06;
  const url = h * 0.04;

  // Measure the column so it can be centered vertically next to the code.
  const titleLines = title
    ? fitText(measurer(ctx, 800), title, colW, titleSize, titleSize * 0.6, 2)
    : null;
  const headLines = fitText(
    measurer(ctx, 800),
    'Scanează și rezervă',
    colW,
    headline,
    headline * 0.6,
    2,
  );
  const blockH =
    (titleLines ? titleLines.lines.length * titleLines.size * 1.15 + h * 0.015 : 0) +
    (c.priceText ? sub * 1.15 + h * 0.04 : h * 0.03) +
    headLines.lines.length * headLines.size * 1.15 +
    sub * 1.15;
  let y = band + (h - band - url * 2 - blockH) / 2;

  if (title) {
    y +=
      h * 0.015 +
      drawText(ctx, title, {
        x: pad,
        y,
        maxWidth: colW,
        size: titleSize,
        maxLines: 2,
        weight: 800,
        align: 'left',
      });
  }
  if (c.priceText) {
    y += drawText(ctx, c.priceText, {
      x: pad,
      y,
      maxWidth: colW,
      size: sub,
      weight: 600,
      color: MUTED,
      align: 'left',
    });
    y += h * 0.04;
  } else {
    y += h * 0.03;
  }
  y += drawText(ctx, 'Scanează și rezervă', {
    x: pad,
    y,
    maxWidth: colW,
    size: headline,
    maxLines: 2,
    weight: 800,
    align: 'left',
  });
  drawText(ctx, 'Scan & book online', {
    x: pad,
    y,
    maxWidth: colW,
    size: sub,
    weight: 600,
    color: MUTED,
    align: 'left',
  });
  drawText(ctx, c.displayUrl, {
    x: pad,
    y: h - pad * 0.6 - url * 1.2,
    maxWidth: colW,
    size: url,
    color: MUTED,
    align: 'left',
  });
}

/**
 * Draws a whole page of the format at `dpi`. Returns the canvas; the caller exports it.
 */
export function renderKitPage(
  canvas: HTMLCanvasElement,
  spec: KitFormatSpec,
  content: KitContent,
  dpi: number,
): HTMLCanvasElement {
  const px = dpi / 25.4;
  canvas.width = Math.round(spec.page.w * px);
  canvas.height = Math.round(spec.page.h * px);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const panel of spec.panels) {
    const w = panel.w * px;
    const h = panel.h * px;
    ctx.save();
    ctx.translate(panel.x * px, panel.y * px);
    if (panel.flipped) {
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
    }
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    if (h >= w) drawPortrait(ctx, content, w, h);
    else drawLandscape(ctx, content, w, h);
    ctx.restore();
  }

  ctx.save();
  ctx.lineWidth = Math.max(1, 0.25 * px);
  if (spec.cutGuides) {
    ctx.strokeStyle = '#b8c1cc';
    ctx.setLineDash([2 * px, 1.5 * px]);
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const p of spec.panels) {
      if (p.x > 0) xs.add(p.x);
      if (p.y > 0) ys.add(p.y);
    }
    for (const x of xs) {
      ctx.beginPath();
      ctx.moveTo(x * px, 0);
      ctx.lineTo(x * px, canvas.height);
      ctx.stroke();
    }
    for (const y of ys) {
      ctx.beginPath();
      ctx.moveTo(0, y * px);
      ctx.lineTo(canvas.width, y * px);
      ctx.stroke();
    }
  }
  for (const fold of spec.folds ?? []) {
    ctx.strokeStyle = '#8391a3';
    ctx.setLineDash([3 * px, 2 * px]);
    ctx.beginPath();
    ctx.moveTo(0, fold * px);
    ctx.lineTo(canvas.width, fold * px);
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

/** Loads an image for the canvas; null when it fails or would block exporting the canvas. */
export function loadLogo(
  url: string | null | undefined,
  timeoutMs = 6000,
): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    // Without CORS the image would taint the canvas and the PNG/PDF export would fail.
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

export function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('export failed'))),
        type,
        quality,
      );
    } catch (error) {
      reject(error);
    }
  });
}
