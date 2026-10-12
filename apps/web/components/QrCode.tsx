import { create as createQr } from 'qrcode';

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * Builds an SVG path for the dark modules of a QR code. Runs of dark modules on a row are
 * merged into one rectangle, which keeps the path short and renders crisply at any size.
 */
export function qrPath(value: string, level: QrErrorLevel = 'M'): { path: string; size: number } {
  const qr = createQr(value, { errorCorrectionLevel: level });
  const { size, data } = qr.modules;
  const quiet = 4;
  let path = '';
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (data[row * size + col]) {
        const start = col;
        while (col < size && data[row * size + col]) col++;
        path += `M${start + quiet} ${row + quiet}h${col - start}v1h-${col - start}z`;
      } else {
        col++;
      }
    }
  }
  return { path, size: size + quiet * 2 };
}

interface QrCodeProps {
  value: string;
  /** Accessible description, e.g. "Cod QR pentru rezervare". */
  label: string;
  level?: QrErrorLevel;
  className?: string;
}

/**
 * QR code rendered synchronously to inline SVG (no canvas, no network): works offline and in
 * server-rendered pages. Always dark-on-white with a quiet zone so every camera can read it.
 */
export function QrCode({ value, label, level = 'M', className = '' }: QrCodeProps) {
  let content: { path: string; size: number } | null = null;
  try {
    content = qrPath(value, level);
  } catch {
    content = null;
  }
  if (!content) {
    return (
      <div
        className={`qr-surface flex aspect-square items-center justify-center rounded-2xl p-4 text-center ${className}`}
      >
        Codul QR nu poate fi generat.
      </div>
    );
  }
  return (
    <div className={`qr-surface rounded-2xl ${className}`}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${content.size} ${content.size}`}
        shapeRendering="crispEdges"
        className="block h-auto w-full"
      >
        <rect width={content.size} height={content.size} fill="#ffffff" />
        <path d={content.path} fill="#000000" />
      </svg>
    </div>
  );
}
