import type { BrandingDto } from '@ap/contracts';
import { Suspense, type ReactNode } from 'react';
import type { Lang } from '@/lib/i18n';
import { serverLanguageFile, serverLanguages, serverOverrides } from '@/lib/i18n-server';
import { PublicFrame } from './PublicFrame';
import { PublicI18n } from './PublicI18n';

// Client-safe parts, re-exported for server pages. Client components import them from
// './PublicFrame' (this file reads the request on the server).
export { BrandScope, PublicFrame, PublicMessage } from './PublicFrame';

/**
 * Server frame of the public (tourist) pages: the page language with the admin's texts, the
 * operator name or logo and the language switcher. Client components inside read the language
 * and texts with `useT()`. With `bare`, only the language is provided and the children render
 * their own `PublicFrame` (pages that learn the operator on the client, like the ticket).
 */
export async function PublicShell({
  lang,
  tenantName,
  branding,
  homeHref,
  bare = false,
  children,
}: {
  lang: Lang;
  /** Unused; kept so pages can pass their path. */
  path?: string;
  tenantName?: string | null;
  branding?: BrandingDto | null;
  homeHref?: string;
  bare?: boolean;
  children: ReactNode;
}) {
  const [languages, overrides] = await Promise.all([serverLanguages(), serverOverrides(lang)]);
  return (
    <Suspense>
      <PublicI18n
        lang={lang}
        languages={languages}
        overrides={overrides}
        file={serverLanguageFile(lang)}
      >
        {bare ? (
          children
        ) : (
          <PublicFrame tenantName={tenantName} branding={branding} homeHref={homeHref}>
            {children}
          </PublicFrame>
        )}
      </PublicI18n>
    </Suspense>
  );
}
