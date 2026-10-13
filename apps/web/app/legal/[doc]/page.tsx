import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/public/SiteShell';
import { formatDate } from '@/lib/dates';
import type { MessageKey } from '@/lib/i18n';
import { getServerT, serverLang } from '@/lib/i18n-server';

/**
 * The booking terms and the privacy policy. They cover every operator on the platform: the
 * operator's own cancellation policy and contact details are on their booking page and ticket.
 */
const DOCS = {
  terms: [
    'who',
    'booking',
    'ticket',
    'yourCancel',
    'operatorCancel',
    'onTheDay',
    'liability',
    'contact',
  ],
  privacy: [
    'controller',
    'data',
    'purposes',
    'recipients',
    'retention',
    'rights',
    'cookies',
    'contact',
  ],
} as const;

type Doc = keyof typeof DOCS;

/** When the texts last changed; update it with them. */
const UPDATED = '2026-10-12T12:00:00Z';

interface Props {
  params: Promise<{ doc: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}

const isDoc = (doc: string): doc is Doc => Object.hasOwn(DOCS, doc);

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ doc }, query] = await Promise.all([params, searchParams]);
  if (!isDoc(doc)) return {};
  const { t } = await getServerT(await serverLang(query.lang));
  return { title: t(`legal.${doc}.title` as MessageKey) };
}

export default async function LegalPage({ params, searchParams }: Props) {
  const [{ doc }, query] = await Promise.all([params, searchParams]);
  if (!isDoc(doc)) notFound();
  const lang = await serverLang(query.lang);
  const { t } = await getServerT(lang);
  const app = t('common.appName');
  const key = (k: string) => `legal.${doc}.${k}` as MessageKey;
  return (
    <SiteShell lang={lang}>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight">{t(key('title'))}</h1>
          <p className="text-sm text-muted">
            {t('legal.updated', { date: formatDate(UPDATED, 'UTC', lang) })}
          </p>
          <p className="text-lg text-muted">{t(key('intro'), { app })}</p>
        </header>
        {DOCS[doc].map((section) => (
          <section
            key={section}
            aria-labelledby={`legal-${section}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`legal-${section}`} className="text-xl font-bold">
              {t(key(`sections.${section}.title`))}
            </h2>
            <p className="whitespace-pre-line leading-relaxed">
              {t(key(`sections.${section}.text`), { app })}
            </p>
          </section>
        ))}
      </article>
    </SiteShell>
  );
}
