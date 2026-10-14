'use client';

import Link from 'next/link';
import { ButtonLink } from '../Button';
import { useT } from '../I18nProvider';
import { LanguageSwitcher } from '../LanguageSwitcher';

/** Header of the platform's own pages (home, contact, legal): name, language, sign in. */
export function SiteHeader() {
  const { t, lang } = useT();
  return (
    <header
      className="page-x mx-auto flex max-w-5xl items-center justify-between gap-4 py-4"
      style={{ paddingTop: 'max(1rem, var(--safe-top))' }}
    >
      <Link href={`/?lang=${lang}`} className="flex min-h-12 items-center gap-2 text-lg font-bold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={36} height={36} className="rounded-xl" />
        {t('common.appName')}
      </Link>
      <div className="flex items-center gap-1">
        <Link
          href={`/contact?lang=${lang}`}
          className="hidden min-h-12 items-center rounded-xl px-3 font-semibold text-muted hover:bg-surface-2 sm:inline-flex"
        >
          {t('public.site.contact')}
        </Link>
        <LanguageSwitcher compact />
        <ButtonLink href="/login" variant="secondary">
          {t('common.signIn')}
        </ButtonLink>
      </div>
    </header>
  );
}

/** Footer of the platform's own pages, with the contact page and the legal pages. */
export function SiteFooter() {
  const { t, lang } = useT();
  const links = [
    { href: `/contact?lang=${lang}`, label: t('public.site.contact') },
    { href: `/legal/terms?lang=${lang}`, label: t('public.site.terms') },
    { href: `/legal/privacy?lang=${lang}`, label: t('public.site.privacy') },
  ];
  return (
    <footer
      className="page-x mx-auto flex max-w-5xl flex-col gap-3 border-t border-line py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
      style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}
    >
      <p>
        {t('public.landing.copyright', {
          year: new Date().getFullYear(),
          name: t('common.appName'),
        })}
      </p>
      <nav aria-label={t('public.site.footerNav')}>
        <ul className="-mx-2 flex flex-wrap">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-12 items-center rounded-xl px-2 font-semibold hover:bg-surface-2 hover:text-fg"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
