// Generates the PWA icons (PNG) and the SVG icon from the same simple geometry:
// a sailing boat and a sun on a sea-blue background. No image libraries needed.
//   node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BRAND = [3, 105, 161];
const WHITE = [255, 255, 255];
const SUN = [251, 191, 36];

// Geometry in a 512×512 design space.
const shapes = [
  { kind: 'circle', cx: 336, cy: 172, r: 54, color: SUN, alpha: 1 },
  {
    kind: 'poly',
    points: [
      [244, 104],
      [244, 330],
      [372, 330],
    ],
    color: WHITE,
    alpha: 1,
  },
  {
    kind: 'poly',
    points: [
      [222, 150],
      [222, 330],
      [134, 330],
    ],
    color: WHITE,
    alpha: 0.85,
  },
  {
    kind: 'poly',
    points: [
      [112, 348],
      [400, 348],
      [356, 404],
      [156, 404],
    ],
    color: WHITE,
    alpha: 1,
  },
  {
    kind: 'wave',
    y: 436,
    amp: 9,
    period: 64,
    thickness: 14,
    x0: 96,
    x1: 416,
    color: WHITE,
    alpha: 0.7,
  },
];

function insidePoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function covers(shape, x, y) {
  switch (shape.kind) {
    case 'circle':
      return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
    case 'poly':
      return insidePoly(x, y, shape.points);
    case 'wave': {
      if (x < shape.x0 || x > shape.x1) return false;
      const center = shape.y + shape.amp * Math.sin((x / shape.period) * Math.PI * 2);
      return Math.abs(y - center) <= shape.thickness / 2;
    }
    default:
      return false;
  }
}

/**
 * Renders the icon. `scale` shrinks the artwork around the center (maskable safe zone),
 * `radius` rounds the background corners (0 = full bleed).
 */
function render(size, { scale = 1, radius = 0 } = {}) {
  const px = new Uint8Array(size * size * 4);
  const ss = 4;
  const k = 512 / size;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = (pxl + (sx + 0.5) / ss) * k;
          const dy = (py + (sy + 0.5) / ss) * k;
          // Background with optional rounded corners.
          let inBg = true;
          if (radius > 0) {
            const cx = Math.min(Math.max(dx, radius), 512 - radius);
            const cy = Math.min(Math.max(dy, radius), 512 - radius);
            inBg = (dx - cx) ** 2 + (dy - cy) ** 2 <= radius ** 2;
          }
          if (!inBg) continue;
          let color = BRAND;
          // Artwork coordinates (inverse of the scale around the center).
          const ax = 256 + (dx - 256) / scale;
          const ay = 256 + (dy - 256) / scale;
          for (const shape of shapes) {
            if (covers(shape, ax, ay)) {
              color = color.map((c, i) =>
                Math.round(c * (1 - shape.alpha) + shape.color[i] * shape.alpha),
              );
            }
          }
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const o = (py * size + pxl) * 4;
      const coverage = a / n;
      // Store straight (non-premultiplied) color.
      px[o] = coverage ? Math.round((r / n) * (255 / coverage)) : 0;
      px[o + 1] = coverage ? Math.round((g / n) * (255 / coverage)) : 0;
      px[o + 2] = coverage ? Math.round((b / n) * (255 / coverage)) : 0;
      px[o + 3] = Math.round(coverage);
    }
  }
  return px;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log('wrote', path);
}

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function svg({ radius = 112 } = {}) {
  const parts = shapes.map((s) => {
    const fill = `fill="${hex(s.color)}"${s.alpha < 1 ? ` fill-opacity="${s.alpha}"` : ''}`;
    if (s.kind === 'circle') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${fill}/>`;
    if (s.kind === 'poly')
      return `<polygon points="${s.points.map((p) => p.join(',')).join(' ')}" ${fill}/>`;
    const pts = [];
    for (let x = s.x0; x <= s.x1; x += 8) {
      pts.push(`${x},${(s.y + s.amp * Math.sin((x / s.period) * Math.PI * 2)).toFixed(1)}`);
    }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${hex(s.color)}" stroke-opacity="${s.alpha}" stroke-width="${s.thickness}" stroke-linecap="round"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${hex(BRAND)}"/>${parts.join('')}</svg>\n`;
}

write(join(root, 'public/icons/icon-192.png'), encodePng(192, render(192, { radius: 42 })));
write(join(root, 'public/icons/icon-512.png'), encodePng(512, render(512, { radius: 112 })));
write(join(root, 'public/icons/maskable-512.png'), encodePng(512, render(512, { scale: 0.78 })));
write(join(root, 'app/apple-icon.png'), encodePng(180, render(180)));
write(join(root, 'public/icons/icon.svg'), svg());
write(join(root, 'app/icon.svg'), svg());
