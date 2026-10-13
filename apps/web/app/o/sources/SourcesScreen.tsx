'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { IconRefresh } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { isApiError } from '@/lib/api';
import type { SourceDto, SyncResultDto } from '@ap/contracts';
import { formatDateTime } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import { errorMessage, useApi } from '@/lib/useApi';
import { useT } from '@/components/I18nProvider';
import { useOperator } from '../OperatorContext';

/** The operator's own booking system: connect it, see what was imported, sync on demand. */
export function SourcesScreen() {
  const { membership } = useSession();
  const i18n = useT();
  const { t } = i18n;
  const sources = useApi(`operator-sources:${membership.tenantId}`, (signal) =>
    operatorApi.sources({ signal }),
  );
  const isOwner = membership.role === 'owner';
  const external = (sources.data ?? []).filter((s) => s.kind === 'rest');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('catalog.sources.title')}
        description={t('catalog.sources.description')}
      />

      <Alert tone="info">
        {t('catalog.sources.noSystemBeforeLink')}{' '}
        <Link href="/o/products" className="font-semibold underline underline-offset-2">
          {t('catalog.sources.noSystemLink')}
        </Link>{' '}
        {t('catalog.sources.noSystemAfterLink')}
      </Alert>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="sources-title" className="flex flex-col gap-3">
          <h2 id="sources-title" className="text-xl font-semibold">
            {t('catalog.sources.connected')}
          </h2>
          {sources.loading && !sources.data ? <LoadingBlock label={t('common.loading')} /> : null}
          {sources.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={sources.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(sources.error, i18n)}
            </Alert>
          ) : null}
          {sources.data && external.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-3 text-muted">{t('catalog.sources.none')}</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {external.map((source) => (
              <li key={source.id}>
                <SourceCard
                  source={source}
                  onSynced={(updated) =>
                    sources.setData((prev) =>
                      (prev ?? []).map((s) => (s.id === updated.id ? updated : s)),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>

        {isOwner ? (
          <ConnectForm
            onConnected={(source) => sources.setData((prev) => [source, ...(prev ?? [])])}
          />
        ) : (
          <Card title={t('catalog.sources.connectTitle')}>
            <p className="text-muted">{t('catalog.sources.ownerOnly')}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  onSynced,
}: {
  source: SourceDto;
  onSynced: (source: SourceDto) => void;
}) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await operatorApi.syncSource(source.id);
      setResult(res);
      onSynced({ ...source, lastSyncedAt: new Date().toISOString(), productCount: res.products });
    } catch (err) {
      setError(
        isApiError(err) && err.status === 502
          ? t('catalog.sources.errNoResponse')
          : errorMessage(err, i18n),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">{source.name}</h3>
          {source.baseUrl ? <p className="break-all text-sm text-muted">{source.baseUrl}</p> : null}
        </div>
        <StatusChip tone={source.active ? 'success' : 'neutral'}>
          {source.active ? t('catalog.sources.active') : t('catalog.sources.inactive')}
        </StatusChip>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted">{t('catalog.sources.lastSync')}</dt>
          <dd className="font-semibold">
            {source.lastSyncedAt ? (
              <time dateTime={source.lastSyncedAt}>
                {formatDateTime(source.lastSyncedAt, tenant.timezone, lang)}
              </time>
            ) : (
              t('catalog.sources.never')
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t('catalog.sources.trips')}</dt>
          <dd className="font-semibold tabular-nums">{source.productCount}</dd>
        </div>
      </dl>
      <div aria-live="polite">
        {result ? (
          <Alert tone="success">
            {t('catalog.sources.synced', {
              trips: tp('catalog.sources.syncedTrips', result.products),
              departures: tp('catalog.sources.syncedDepartures', result.slots),
            })}
          </Alert>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="secondary"
        icon={<IconRefresh />}
        onClick={sync}
        loading={busy}
        loadingText={t('catalog.sources.syncing')}
      >
        {t('catalog.sources.syncNow')}
      </Button>
    </article>
  );
}

function ConnectForm({ onConnected }: { onConnected: (source: SourceDto) => void }) {
  const i18n = useT();
  const { t, tp } = i18n;
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('catalog.sources.errName');
    const url = baseUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) next.baseUrl = t('catalog.sources.errUrl');
    if (!token.trim()) next.token = t('catalog.sources.errToken');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const source = await operatorApi.connectSource({
        name: name.trim(),
        baseUrl: url,
        token: token.trim(),
      });
      onConnected(source);
      setDone(tp('catalog.sources.connectedNotice', source.productCount, { name: source.name }));
      setName('');
      setBaseUrl('');
      setToken('');
    } catch (err) {
      if (isApiError(err) && err.status === 400) {
        setError(t('catalog.sources.errRejected'));
      } else if (isApiError(err) && err.status === 403) {
        setError(t('catalog.sources.ownerOnly'));
      } else {
        setError(errorMessage(err, i18n));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t('catalog.sources.connectTitle')}
      description={t('catalog.sources.connectDescription')}
    >
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
        <Field
          label={t('catalog.sources.name')}
          name="name"
          autoComplete="off"
          placeholder={t('catalog.sources.namePlaceholder')}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Field
          label={t('catalog.sources.apiUrl')}
          name="baseUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t('catalog.sources.apiUrlPlaceholder')}
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          error={errors.baseUrl}
        />
        <Field
          label={t('catalog.sources.token')}
          name="token"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          error={errors.token}
        />
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">{done}</Alert> : null}
        <Button
          type="submit"
          size="lg"
          block
          loading={busy}
          loadingText={t('catalog.sources.connecting')}
        >
          {t('catalog.sources.connect')}
        </Button>
      </form>
    </Card>
  );
}
