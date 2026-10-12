import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { getT, LANGS, translate, type Lang } from '@/lib/i18n';
import { parseHex, readableTextOn } from '@/lib/links';

interface Branding {
  logoUrl?: string;
  primaryColor?: string;
}

/** CSS variables that re-brand the subtree with the operator's color (buttons, links, focus). */
export function brandStyle(branding?: Branding | null): CSSProperties | undefined {
  const color = branding?.primaryColor;
  if (!color || !parseHex(color)) return undefined;
  const hex = color.startsWith('#') ? color : `#${color}`;
  return {
    '--brand': hex,
    '--brand-strong': hex,
    '--on-brand': readableTextOn(hex),
  } as CSSProperties;
}

/**
 * Frame of the public (tourist) pages: operator name or logo, language switcher, content in the
 * page language. `path` is the current path (with any query to keep, but no `lang`), used for the
 * language links.
 */
export function PublicShell({
  lang,
  path,
  tenantName,
  branding,
  homeHref,
  children,
}: {
  lang: Lang;
  path: string;
  tenantName?: string | null;
  branding?: Branding | null;
  homeHref?: string;
  children: ReactNode;
}) {
  const { t } = getT(lang);
  const logo = branding?.logoUrl && /^https:\/\//.test(branding.logoUrl) ? branding.logoUrl : null;
  const title = logo ? (
    // Operator logos come from any host, so a plain <img> rather than next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt={tenantName ?? ''} className="h-10 w-auto max-w-[12rem] object-contain" />
  ) : (
    <span className="truncate text-lg font-bold">{tenantName}</span>
  );

  return (
    <div lang={lang} style={brandStyle(branding)} className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="border-b border-line bg-surface" style={{ paddingTop: 'var(--safe-top)' }}>
        <div className="page-x mx-auto flex min-h-16 max-w-3xl items-center justify-between gap-3">
          {tenantName ? (
            homeHref ? (
              <Link href={homeHref} className="flex min-h-12 min-w-0 items-center">
                {title}
              </Link>
            ) : (
              <div className="flex min-h-12 min-w-0 items-center">{title}</div>
            )
          ) : (
            <span />
          )}
          <nav aria-label={t('language')} className="flex shrink-0 gap-1">
            {LANGS.map((code) => (
              <Link
                key={code}
                href={`${path}${path.includes('?') ? '&' : '?'}lang=${code}`}
                hrefLang={code}
                lang={code}
                aria-current={code === lang ? 'true' : undefined}
                replace
                className={`inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl px-2 text-sm font-semibold uppercase ${
                  code === lang
                    ? 'bg-brand-soft text-brand-soft-fg'
                    : 'text-muted hover:bg-surface-2'
                }`}
              >
                <span aria-hidden="true">{code}</span>
                <span className="visually-hidden">{translate(code, 'langName')}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="content" className="page-x mx-auto w-full max-w-3xl flex-1 pb-10">
        {children}
      </main>
    </div>
  );
}

/** Full-page message for a missing operator, trip or ticket. */
export function PublicMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-12">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
