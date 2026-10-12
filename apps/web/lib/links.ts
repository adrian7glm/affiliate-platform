/** Cookie names shared by the `/r/[code]` redirect and the public checkout. */
export const VISITOR_COOKIE = 'ap_vid';
export const REF_COOKIE = 'ap_ref';
/** How the visitor arrived through the affiliate link: 'qr' (scanned, `?s=qr`) or 'link'. */
export const SOURCE_COOKIE = 'ap_src';

/** Reads a cookie in the browser. */
export function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const item = part.trim();
      if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length));
    }
  } catch {
    // Cookies blocked.
  }
  return null;
}

/**
 * Extracts `{ bookingId, key }` from a ticket URL returned by the API
 * (`https://…/t/<bookingId>?k=<key>`). Null when the URL has another shape.
 */
export function parseTicketUrl(ticketUrl: string): { bookingId: string; key: string } | null {
  try {
    const url = new URL(ticketUrl, 'http://placeholder.local');
    const match = url.pathname.match(/\/t\/([^/]+)\/?$/);
    const key = url.searchParams.get('k');
    if (!match?.[1] || !key) return null;
    return { bookingId: decodeURIComponent(match[1]), key };
  } catch {
    return null;
  }
}

/** Local path of a ticket page, so the app can link to it without leaving the current origin. */
export function ticketPath(bookingId: string, key: string, lang?: string): string {
  const params = new URLSearchParams({ k: key });
  if (lang) params.set('lang', lang);
  return `/t/${encodeURIComponent(bookingId)}?${params.toString()}`;
}

/** Picks black or white text for a background color given as #rgb or #rrggbb. */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  const rgb = parseHex(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white vs black: pick the larger.
  const withWhite = 1.05 / (luminance + 0.05);
  const withBlack = (luminance + 0.05) / 0.05;
  return withWhite >= withBlack ? '#ffffff' : '#000000';
}

export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
