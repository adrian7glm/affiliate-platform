import type { Metadata } from 'next';
import { SiteShell } from '@/components/public/SiteShell';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { ContactForm } from './ContactForm';

interface Props {
  searchParams: Promise<{ lang?: string | string[]; topic?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getServerT(await serverLang((await searchParams).lang));
  return { title: t('public.contact.title'), description: t('public.contact.intro') };
}

/** Operators ask for a demo or write a question; the platform owner gets an email. */
export default async function ContactPage({ searchParams }: Props) {
  const query = await searchParams;
  const lang = await serverLang(query.lang);
  const { t } = await getServerT(lang);
  return (
    <SiteShell lang={lang}>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight">{t('public.contact.title')}</h1>
          <p className="text-lg text-muted">{t('public.contact.intro')}</p>
        </header>
        <ContactForm initialTopic={query.topic === 'question' ? 'question' : 'demo'} />
      </div>
    </SiteShell>
  );
}
