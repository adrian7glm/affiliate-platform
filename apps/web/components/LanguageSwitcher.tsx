'use client';

import { useId } from 'react';
import { useT } from './I18nProvider';
import { IconGlobe } from './icons';

/**
 * Language picker: a native select, so the phone shows its own list however many languages
 * there are. `compact` shows only the language code (headers on small screens).
 */
export function LanguageSwitcher({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { lang, languages, setLang, t } = useT();
  const id = useId();
  if (languages.length < 2) return null;
  const current = languages.find((l) => l.code === lang);
  return (
    <div
      className={`relative inline-flex min-h-12 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted has-[select:focus-visible]:outline has-[select:focus-visible]:outline-3 has-[select:focus-visible]:outline-[var(--focus)] hover:bg-surface-2 ${className}`}
    >
      <IconGlobe size={18} />
      <span aria-hidden="true" className={compact ? 'uppercase' : ''}>
        {compact ? lang : (current?.name ?? lang)}
      </span>
      <label htmlFor={id} className="visually-hidden">
        {t('common.language')}
      </label>
      <select
        id={id}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
