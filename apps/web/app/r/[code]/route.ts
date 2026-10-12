import type { ClickResultDto } from '@ap/contracts';
import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';
import { REF_COOKIE, SOURCE_COOKIE, VISITOR_COOKIE } from '@/lib/links';
import { SERVER_API_URL } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const VISITOR_RE = /^[A-Za-z0-9-]{8,64}$/;
const VISITOR_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Affiliate link / QR entry point: `/r/CODE` (opened link) or `/r/CODE?s=qr` (scanned QR).
 * Records the click, remembers the affiliate in an attribution cookie for the tenant's window,
 * then sends the visitor to the operator's booking page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const home = new URL('/', request.url);
  if (!CODE_RE.test(code)) return NextResponse.redirect(home, 302);

  const source: 'qr' | 'link' = request.nextUrl.searchParams.get('s') === 'qr' ? 'qr' : 'link';
  const lang = request.nextUrl.searchParams.get('lang');

  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId =
    existingVisitor && VISITOR_RE.test(existingVisitor) ? existingVisitor : crypto.randomUUID();

  let click: ClickResultDto;
  try {
    click = await apiFetch<ClickResultDto>(`/public/links/${encodeURIComponent(code)}/click`, {
      method: 'POST',
      auth: false,
      baseUrl: SERVER_API_URL,
      body: {
        visitorId,
        userAgent: request.headers.get('user-agent')?.slice(0, 400) || undefined,
        referrer: request.headers.get('referer')?.slice(0, 400) || undefined,
      },
    });
  } catch {
    // Unknown or inactive code (404), or the API is unreachable: there is nowhere better to go.
    return NextResponse.redirect(home, 302);
  }

  const path = click.productSlug
    ? `/b/${encodeURIComponent(click.tenantSlug)}/${encodeURIComponent(click.productSlug)}`
    : `/b/${encodeURIComponent(click.tenantSlug)}`;
  const target = new URL(path, request.url);
  if (lang) target.searchParams.set('lang', lang);

  const response = NextResponse.redirect(target, 302);
  const secure = request.nextUrl.protocol === 'https:';
  const maxAge = Math.max(1, Math.round(click.attributionWindowDays)) * 24 * 60 * 60;
  const common = { path: '/', sameSite: 'lax' as const, httpOnly: false, secure };

  response.cookies.set(REF_COOKIE, code, { ...common, maxAge });
  response.cookies.set(SOURCE_COOKIE, source, { ...common, maxAge });
  response.cookies.set(VISITOR_COOKIE, visitorId, { ...common, maxAge: VISITOR_MAX_AGE });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
