import { Suspense, type ReactNode } from 'react';
import type { Lang } from '@/lib/i18n';
import { serverLanguages, serverOverrides } from '@/lib/i18n-server';
import { PublicI18n } from './PublicI18n';
import { SiteFooter, SiteHeader } from './SiteChrome';

/** Server frame of the platform's own pages (contact, legal): language, header and footer. */
export async function SiteShell({ lang, children }: { lang: Lang; children: ReactNode }) {
  const [languages, overrides] = await Promise.all([serverLanguages(), serverOverrides(lang)]);
  return (
    <Suspense>
      <PublicI18n lang={lang} languages={languages} overrides={overrides}>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main id="content" className="page-x mx-auto w-full max-w-3xl flex-1 pb-12 pt-4">
            {children}
          </main>
          <SiteFooter />
        </div>
      </PublicI18n>
    </Suspense>
  );
}
