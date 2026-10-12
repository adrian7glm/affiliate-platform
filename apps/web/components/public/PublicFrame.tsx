'use client';

import type { BrandingDto } from '@ap/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { brandCss, safeLogoUrl } from '@/lib/brandColors';
import { useT } from '../I18nProvider';
import { LanguageSwitcher } from '../LanguageSwitcher';

/**
 * Re-brands its children with the operator's color (buttons, links, focus rings), with shades
 * adjusted for contrast in light and dark mode.
 */
export function BrandScope({
  color,
  className,
  children,
}: {
  color?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const css = brandCss('.brand-scope', color);
  return (
    <div className={`brand-scope ${className ?? ''}`}>
      {css ? <style>{css}</style> : null}
      {children}
    </div>
  );
}

/**
 * Visible frame of a public (tourist) page: operator name or logo, language switcher, content.
 * Must sit inside the page's language provider (`PublicShell` puts it there); client pages
 * that only know the operator after loading (the ticket) render it themselves.
 */
export function PublicFrame({
  tenantName,
  branding,
  homeHref,
  children,
}: {
  tenantName?: string | null;
  branding?: BrandingDto | null;
  homeHref?: string;
  children: ReactNode;
}) {
  const { lang } = useT();
  const logo = safeLogoUrl(branding?.logoUrl);
  const title = logo ? (
    // Operator logos come from any host, so a plain <img> rather than next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={tenantName ?? ''}
      className="h-10 w-auto max-w-[12rem] rounded-lg object-contain dark:bg-white dark:px-2 dark:py-1"
    />
  ) : (
    <span className="truncate text-lg font-bold">{tenantName}</span>
  );

  return (
    <BrandScope color={branding?.primaryColor}>
      <div lang={lang} className="flex min-h-dvh flex-col bg-bg text-fg">
        <header
          className="border-b border-line bg-surface"
          style={{ paddingTop: 'var(--safe-top)' }}
        >
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
            <LanguageSwitcher />
          </div>
        </header>
        <main id="content" className="page-x mx-auto w-full max-w-3xl flex-1 pb-10">
          {children}
        </main>
      </div>
    </BrandScope>
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
