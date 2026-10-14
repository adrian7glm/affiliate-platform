'use client';

import type { DemoAccountDto } from '@ap/contracts';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useT } from '@/components/I18nProvider';
import { IconCheck, IconCopy } from '@/components/icons';
import { copyText } from '@/lib/share';

/**
 * Ready-made accounts for trying every part of the platform. The API lists them only while
 * DEMO_MODE is on, so they disappear from the sign-in page with that one switch.
 */
export function DemoAccounts({
  accounts,
  busy,
  onUse,
}: {
  accounts: DemoAccountDto[];
  busy: boolean;
  onUse: (account: DemoAccountDto) => void;
}) {
  const { t } = useT();
  return (
    <section
      aria-labelledby="demo-accounts-title"
      className="rounded-3xl border-2 border-dashed border-line-strong bg-surface-2 p-4"
    >
      <h2 id="demo-accounts-title" className="text-lg font-semibold">
        {t('auth.login.demo.title')}
      </h2>
      <p className="mt-0.5 text-sm text-muted">{t('auth.login.demo.intro')}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {accounts.map((account) => (
          <li key={account.role} className="rounded-2xl border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-semibold">
                  {t(`auth.login.demo.role.${account.role}`)}
                </span>
                <span className="block text-sm text-muted">
                  {t(`auth.login.demo.what.${account.role}`)}
                </span>
              </span>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => onUse(account)}
                className="shrink-0"
              >
                {t('auth.login.demo.signIn')}
              </Button>
            </div>
            <dl className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-1.5">
              <CopyRow label={t('auth.login.demo.email')} value={account.email} />
              <CopyRow label={t('auth.login.demo.password')} value={account.password} />
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-2 py-1 pl-3 pr-1">
      <dt className="w-14 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono text-sm">{value}</dd>
      <dd className="shrink-0">
        <button
          type="button"
          onClick={async () => setCopied(await copyText(value))}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand hover:bg-brand-soft"
          aria-label={t('auth.login.demo.copy', { what: label })}
        >
          {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
          <span aria-live="polite">
            {copied ? t('auth.login.demo.copied') : t('auth.login.demo.copyShort')}
          </span>
        </button>
      </dd>
    </div>
  );
}
