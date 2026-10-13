import type { Metadata } from 'next';
import { PublicMessage, PublicShell } from '@/components/public/PublicShell';
import { getServerT } from '@/lib/i18n-server';
import { requestLang } from '@/lib/public-server';
import { DevPayForm } from './DevPayForm';

interface Props {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ k?: string | string[]; lang?: string | string[] }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getServerT(await requestLang((await searchParams).lang));
  return {
    title: { absolute: t('public.devPayTitle') },
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/** Stand-in for the card payment page when the API runs with PAYMENTS_PROVIDER=fake. */
export default async function DevPayPage({ params, searchParams }: Props) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const lang = await requestLang(query.lang);
  const key = (Array.isArray(query.k) ? query.k[0] : query.k) ?? '';
  const path = `/dev/pay/${encodeURIComponent(bookingId)}?k=${encodeURIComponent(key)}`;
  const { t } = await getServerT(lang);

  return (
    <PublicShell lang={lang} path={path}>
      {key ? (
        <DevPayForm bookingId={bookingId} ticketKey={key} />
      ) : (
        <PublicMessage title={t('ticket.notFound')} />
      )}
    </PublicShell>
  );
}
