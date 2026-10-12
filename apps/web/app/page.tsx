import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/Button';
import { IconCalendarPlus, IconPercent, IconQr, IconTicket } from '@/components/icons';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PublicI18n } from '@/components/public/PublicI18n';
import type { Translator } from '@/lib/i18n';
import { getServerT, serverLang, serverLanguages, serverOverrides } from '@/lib/i18n-server';

const FEATURES = [
  { key: 'qr', icon: <IconQr size={28} /> },
  { key: 'fast', icon: <IconCalendarPlus size={28} /> },
  { key: 'commission', icon: <IconPercent size={28} /> },
  { key: 'tickets', icon: <IconTicket size={28} /> },
] as const;

const STEPS = ['products', 'invite', 'recommend', 'pay'] as const;

interface Props {
  searchParams: Promise<{ lang?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { t } = await getServerT(await serverLang((await searchParams).lang));
  return { title: { absolute: t('common.appFullName') }, description: t('common.appDescription') };
}

/** Marketing page for operators. Switching the language reloads it with `?lang=`. */
export default async function LandingPage({ searchParams }: Props) {
  const lang = await serverLang((await searchParams).lang);
  const [{ t }, languages, overrides] = await Promise.all([
    getServerT(lang),
    serverLanguages(),
    serverOverrides(lang),
  ]);
  const appName = t('common.appName');
  return (
    <Suspense>
      <PublicI18n lang={lang} languages={languages} overrides={overrides}>
        <LandingContent t={t} appName={appName} />
      </PublicI18n>
    </Suspense>
  );
}

function LandingContent({ t, appName }: { t: Translator['t']; appName: string }) {
  return (
    <div className="min-h-dvh">
      <header
        className="page-x mx-auto flex max-w-5xl items-center justify-between gap-4 py-4"
        style={{ paddingTop: 'max(1rem, var(--safe-top))' }}
      >
        <Link href="/" className="flex min-h-12 items-center gap-2 text-lg font-bold">
          <img src="/icons/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
          {appName}
        </Link>
        <div className="flex items-center gap-1">
          <LanguageSwitcher compact />
          <ButtonLink href="/login" variant="secondary">
            {t('common.signIn')}
          </ButtonLink>
        </div>
      </header>

      <main id="content">
        <section className="page-x mx-auto max-w-5xl py-10 sm:py-16" aria-labelledby="hero-title">
          <p className="mb-3 font-semibold text-brand">
            {t('public.landing.tagline')}
          </p>
          <h1
            id="hero-title"
            className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl"
          >
            {t('public.landing.title')}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            {t('public.landing.intro')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/start" size="lg">
              {t('public.landing.startFree')}
            </ButtonLink>
            <ButtonLink href="/login" size="lg" variant="secondary">
              {t('common.signIn')}
            </ButtonLink>
            <ButtonLink href="#cum-functioneaza" size="lg" variant="ghost">
              {t('public.landing.howItWorks')}
            </ButtonLink>
          </div>
        </section>

        <section className="page-x mx-auto max-w-5xl pb-12" aria-labelledby="features-title">
          <h2 id="features-title" className="visually-hidden">
            {t('public.landing.featuresTitle')}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.key} className="rounded-3xl border border-line bg-surface p-5">
                <div className="mb-3 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-soft-fg">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold">
                  {t(`public.landing.features.${feature.key}.title`)}
                </h3>
                <p className="mt-1 text-muted">
                  {t(`public.landing.features.${feature.key}.text`)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="cum-functioneaza"
          className="page-x mx-auto max-w-5xl pb-16"
          aria-labelledby="how-title"
        >
          <h2 id="how-title" className="text-2xl font-bold">
            {t('public.landing.howItWorks')}
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand font-bold text-on-brand">
                  {i + 1}
                </span>
                <span className="pt-1">{t(`public.landing.steps.${step}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer
        className="page-x mx-auto max-w-5xl border-t border-line py-6 text-sm text-muted"
        style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}
      >
        {t('public.landing.copyright', { year: new Date().getFullYear(), name: appName })}
      </footer>
    </div>
  );
}
