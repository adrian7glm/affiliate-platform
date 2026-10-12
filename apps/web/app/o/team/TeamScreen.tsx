'use client';

import type { ScannerAccountDto } from '@ap/contracts';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { IconScan } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { bt } from '@/lib/boarding-text';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { formatDateTime } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

/** The operator gives and takes away scanner accounts for the people at boarding. */
export function TeamScreen() {
  const { tenant } = useOperator();
  const scanners = useApi('operator-scanners', (signal) => operatorApi.scanners({ signal }));
  const [added, setAdded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ScannerAccountDto | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={bt('teamTitle')} description={bt('teamDescription')} />

      <AddForm
        onAdded={(account) => {
          setAdded(bt('teamAdded', { name: account.name ?? '' }));
          scanners.setData((prev) => [...(prev ?? []), account]);
        }}
      />
      {added ? (
        <Alert tone="success" title={added}>
          {bt('teamHowTo')}
        </Alert>
      ) : null}

      <Card title={bt('teamListTitle')}>
        {scanners.loading && !scanners.data ? (
          <LoadingBlock />
        ) : scanners.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={scanners.reload}>
                {bt('tryAgain')}
              </Button>
            }
          >
            {errorMessageRo(scanners.error)}
          </Alert>
        ) : (scanners.data ?? []).length === 0 ? (
          <p className="text-muted">{bt('teamEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {(scanners.data ?? []).map((account) => (
              <li
                key={account.userId}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg">
                    <IconScan />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{account.name ?? bt('noName')}</p>
                    <p className="truncate text-sm text-muted">{account.phone ?? account.email}</p>
                    <p className="text-sm text-muted">
                      {account.lastScanAt
                        ? bt('teamLastScan', {
                            when: formatDateTime(account.lastScanAt, tenant.timezone),
                          })
                        : bt('teamNeverScanned')}
                    </p>
                  </div>
                </div>
                <Button variant="secondary" onClick={() => setRemoving(account)}>
                  {bt('teamRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RemoveDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(userId) => {
          setRemoving(null);
          setAdded(null);
          scanners.setData((prev) => (prev ?? []).filter((a) => a.userId !== userId));
        }}
      />
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: (account: ScannerAccountDto) => void }) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [errors, setErrors] = useState<{ name?: string; destination?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = bt('teamErrorName');
    const isMail = destination.includes('@');
    const clean = isMail ? normalizeEmail(destination) : normalizePhone(destination);
    if (!(isMail ? isValidEmail(clean) : isValidPhone(clean))) {
      next.destination = bt('teamErrorContact');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      const account = await operatorApi.addScanner({ name: name.trim(), destination: clean });
      onAdded(account);
      setName('');
      setDestination('');
    } catch (err) {
      setError(
        isApiError(err) && err.status === 409 ? bt('teamErrorDuplicate') : errorMessageRo(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={bt('teamAdd')}>
      <form onSubmit={submit} method="post" noValidate className="grid gap-4 md:grid-cols-2">
        <Field
          label={bt('teamName')}
          hint={bt('teamNameHint')}
          name="name"
          autoComplete="off"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Field
          label={bt('teamContact')}
          hint={bt('teamContactHint')}
          name="destination"
          autoComplete="off"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          error={errors.destination}
        />
        {error ? (
          <div className="md:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <div className="md:col-span-2">
          <Button type="submit" size="lg" loading={busy} block className="md:w-auto">
            {bt('teamSubmit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RemoveDialog({
  account,
  onClose,
  onRemoved,
}: {
  account: ScannerAccountDto | null;
  onClose: () => void;
  onRemoved: (userId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      await operatorApi.removeScanner(account.userId);
      onRemoved(account.userId);
    } catch (err) {
      // Already removed elsewhere: the list is simply out of date.
      if (isApiError(err) && err.isNotFound) onRemoved(account.userId);
      else setError(errorMessageRo(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={account !== null}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={bt('teamRemoveTitle', { name: account?.name ?? bt('noName') })}
      description={bt('teamRemoveText')}
    >
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button variant="danger" size="lg" block loading={busy} onClick={() => void remove()}>
          {bt('teamRemoveConfirm')}
        </Button>
        <Button variant="secondary" size="lg" block onClick={onClose}>
          {bt('cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
