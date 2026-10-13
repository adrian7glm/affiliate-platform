'use client';

import type { AdminAccountDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { PageHeader } from '@/components/PageHeader';
import { StatusChip } from '@/components/StatusChip';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { formatDate } from '@/lib/dates';
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessage } from '@/lib/useApi';

type Action = 'reset' | 'signOut';

/**
 * Support for one person's account: who it is, and the two things support may do for them
 * when they cannot do it themselves (reset two-step login, sign out every device).
 */
export function AccountsAdmin() {
  const i18n = useT();
  const { t } = i18n;
  const [raw, setRaw] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ account: AdminAccountDto | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contact = raw.includes('@') ? normalizeEmail(raw) : normalizePhone(raw);
    if (!isValidEmail(contact) && !isValidPhone(contact)) {
      setFieldError(t('admin.accounts.contactInvalid'));
      return;
    }
    setFieldError(null);
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setResult(await adminApi.findAccount(contact));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('admin.accounts.title')} description={t('admin.accounts.description')} />
      <Card>
        <form onSubmit={search} noValidate className="flex flex-col gap-4">
          <Field
            label={t('admin.accounts.contactLabel')}
            hint={t('admin.accounts.contactHint')}
            name="contact"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            error={fieldError}
          />
          <Button type="submit" loading={busy} loadingText="…" className="self-start">
            {t('admin.accounts.search')}
          </Button>
        </form>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {result && !result.account ? <Alert tone="info">{t('admin.accounts.notFound')}</Alert> : null}
      {result?.account ? (
        <AccountCard
          account={result.account}
          onChanged={(account, message) => {
            setResult({ account });
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

function AccountCard({
  account,
  onChanged,
}: {
  account: AdminAccountDto;
  onChanged: (account: AdminAccountDto, message: string) => void;
}) {
  const i18n = useT();
  const { t, tk, lang } = i18n;
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action === 'reset') {
        onChanged(await adminApi.resetAccountTwoFactor(account.id), t('admin.accounts.resetDone'));
      } else {
        onChanged(await adminApi.signOutAccount(account.id), t('admin.accounts.signOutDone'));
      }
      setAction(null);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={account.name ?? account.email ?? account.phone ?? ''}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted">{t('admin.accounts.phone')}</dt>
        <dd className="break-all font-semibold">{account.phone ?? '—'}</dd>
        <dt className="text-muted">{t('admin.accounts.email')}</dt>
        <dd className="break-all font-semibold">{account.email ?? '—'}</dd>
        <dt className="text-muted">{t('admin.accounts.since')}</dt>
        <dd>{formatDate(account.createdAt, null, lang)}</dd>
        <dt className="text-muted">{t('admin.accounts.twoFactor')}</dt>
        <dd>
          {account.twoFactorEnabled && account.twoFactorEnabledAt ? (
            <StatusChip tone="success">
              {t('admin.accounts.twoFactorOnSince', {
                date: formatDate(account.twoFactorEnabledAt, null, lang),
              })}
            </StatusChip>
          ) : (
            <StatusChip>{t('admin.accounts.twoFactorOff')}</StatusChip>
          )}
        </dd>
      </dl>
      <h3 className="mt-5 font-semibold">{t('admin.accounts.memberships')}</h3>
      {account.isPlatformAdmin || account.memberships.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {account.isPlatformAdmin ? <li>{t('admin.accounts.platformAdmin')}</li> : null}
          {account.memberships.map((m) => (
            <li key={`${m.tenantId}-${m.role}`}>
              <span className="font-semibold">{m.tenantName}</span>
              <span className="text-muted"> · {tk(`auth.role.${m.role}`)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted">{t('admin.accounts.noMemberships')}</p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        {account.twoFactorEnabled ? (
          <Button variant="secondary" onClick={() => setAction('reset')}>
            {t('admin.accounts.reset')}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => setAction('signOut')}>
          {t('admin.accounts.signOut')}
        </Button>
      </div>
      {action ? (
        <Dialog
          open
          onClose={() => setAction(null)}
          title={
            action === 'reset' ? t('admin.accounts.resetTitle') : t('admin.accounts.signOutTitle')
          }
          description={
            action === 'reset' ? t('admin.accounts.resetBody') : t('admin.accounts.signOutBody')
          }
        >
          <div className="flex flex-col gap-4">
            {action === 'reset' ? (
              <Alert tone="warning">{t('admin.accounts.checkIdentity')}</Alert>
            ) : null}
            {error ? <Alert tone="error">{error}</Alert> : null}
            <Button
              variant={action === 'reset' ? 'danger' : 'primary'}
              block
              loading={busy}
              loadingText="…"
              onClick={() => void run()}
            >
              {action === 'reset'
                ? t('admin.accounts.resetConfirm')
                : t('admin.accounts.signOutConfirm')}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
