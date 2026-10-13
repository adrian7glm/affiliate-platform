'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from './I18nProvider';
import { IconChevronLeft } from './icons';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, backHref, backLabel, actions }: PageHeaderProps) {
  const { t } = useT();
  return (
    <header className="flex flex-col gap-2 pb-4 pt-4">
      {backHref ? (
        <Link
          href={backHref}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 self-start rounded-xl px-2 font-semibold text-brand"
        >
          <IconChevronLeft size={20} />
          {backLabel ?? t('common.back')}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          {description ? <p className="mt-1 text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
