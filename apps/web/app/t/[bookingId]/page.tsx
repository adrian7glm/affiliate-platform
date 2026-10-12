import type { Metadata } from 'next';
import { PublicMessage, PublicShell } from '@/components/public/PublicShell';
import { getT, type Lang } from '@/lib/i18n';
import { requestLang } from '@/lib/public-server';
import { TicketView } from './TicketView';

interface Props {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ k?: string | string[]; lang?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) || null;
}

function manifestHref(bookingId: string, key: string, lang: Lang): string {
  const params = new URLSearchParams({ k: key, lang });
  return `/t/${encodeURIComponent(bookingId)}/manifest.webmanifest?${params.toString()}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const key = first(query.k);
  const { t } = getT(lang);
  return {
    title: { absolute: t('ticketTitle') },
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    // Installing the ticket opens this ticket, not the affiliate app.
    manifest: key ? manifestHref(bookingId, key, lang) : undefined,
    appleWebApp: { capable: true, title: t('ticketTitle'), statusBarStyle: 'default' },
  };
}

/** The customer's ticket: QR code for boarding, trip details, payment state. */
export default async function TicketPage({ params, searchParams }: Props) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const key = first(query.k);
  const path = `/t/${encodeURIComponent(bookingId)}`;
  const { t } = getT(lang);

  if (!key) {
    return (
      <PublicShell lang={lang} path={path}>
        <PublicMessage title={t('ticketNotFound')} />
      </PublicShell>
    );
  }

  return <TicketView bookingId={bookingId} ticketKey={key} lang={lang} />;
}
