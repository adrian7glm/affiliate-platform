import { NextResponse, type NextRequest } from 'next/server';
import { THEME_COLOR_LIGHT } from '@/lib/brand';
import { PUBLIC_DEFAULT_LANG, langFromTag } from '@/lib/i18n';
import { getServerT, serverLanguages } from '@/lib/i18n-server';

export const dynamic = 'force-dynamic';

const KEY_RE = /^[A-Za-z0-9_-]{8,200}$/;

/**
 * Per-ticket web app manifest, so "Add to Home screen" on a ticket opens that ticket
 * (the site-wide manifest starts the affiliate app at /a).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await params;
  const key = request.nextUrl.searchParams.get('k') ?? '';
  const langParam = request.nextUrl.searchParams.get('lang');
  const available = (await serverLanguages()).map((l) => l.code);
  const lang = langFromTag(langParam, available) ?? PUBLIC_DEFAULT_LANG;

  const ticketPath = `/t/${bookingId}`;
  const startUrl = `${ticketPath}?${new URLSearchParams({ k: key, lang }).toString()}`;
  const { t } = await getServerT(lang);
  if (!KEY_RE.test(key) || !/^[A-Za-z0-9-]{1,64}$/.test(bookingId)) {
    return new NextResponse(t('public.notFoundTitle'), { status: 404 });
  }
  const name = t('ticket.title');
  const manifest = {
    id: ticketPath,
    name,
    short_name: name,
    lang,
    start_url: startUrl,
    scope: ticketPath,
    display: 'standalone',
    background_color: '#f4f6f8',
    theme_color: THEME_COLOR_LIGHT,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new NextResponse(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
}
