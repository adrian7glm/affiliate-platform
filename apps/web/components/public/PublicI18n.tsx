'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import type { Lang, LanguageInfo, Messages } from '@/lib/i18n';
import { I18nProvider } from '../I18nProvider';

/**
 * Language of a server-rendered public page: fixed by the server, and switching reloads the
 * page with `?lang=` so the server renders it in the new language.
 */
export function PublicI18n({
  lang,
  languages,
  overrides,
  children,
}: {
  lang: Lang;
  languages: LanguageInfo[];
  overrides: Messages;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const onChange = useCallback(
    (next: Lang) => {
      const params = new URLSearchParams(search?.toString());
      params.set('lang', next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, search],
  );
  return (
    <I18nProvider lang={lang} languages={languages} overrides={overrides} onChange={onChange}>
      {children}
    </I18nProvider>
  );
}
