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
import { pluralRo } from '@/lib/i18n';
import { errorMessageRo, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

/** The operator's own booking system: connect it, see what was imported, sync on demand. */
export function SourcesScreen() {
  const { membership } = useSession();
  const sources = useApi(`operator-sources:${membership.tenantId}`, (signal) =>
    operatorApi.sources({ signal }),
  );
  const isOwner = membership.role === 'owner';
  const external = (sources.data ?? []).filter((s) => s.kind === 'rest');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sistemul tău de rezervări"
        description="Dacă ai deja un program de rezervări, îl poți conecta aici: excursiile, prețurile și plecările vin automat din el, iar rezervările făcute prin afiliați ajung tot acolo."
      />

      <Alert tone="info">
        Nu ai un sistem propriu? Nu trebuie să conectezi nimic. Adaugă excursiile și plecările
        direct în{' '}
        <Link href="/o/products" className="font-semibold underline underline-offset-2">
          Excursii și plecări
        </Link>{' '}
        și folosește calendarul platformei.
      </Alert>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="sources-title" className="flex flex-col gap-3">
          <h2 id="sources-title" className="text-xl font-semibold">
            Sisteme conectate
          </h2>
          {sources.loading && !sources.data ? <LoadingBlock label="Se încarcă…" /> : null}
          {sources.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={sources.reload}>
                  Încearcă din nou
                </Button>
              }
            >
              {errorMessageRo(sources.error)}
            </Alert>
          ) : null}
          {sources.data && external.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-3 text-muted">
              Niciun sistem conectat. Folosești calendarul platformei.
            </p>
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
          <Card title="Conectează un sistem">
            <p className="text-muted">
              Doar proprietarul contului poate conecta un sistem de rezervări.
            </p>
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
          ? 'Sistemul tău nu răspunde. Verifică adresa și tokenul, apoi încearcă din nou.'
          : errorMessageRo(err),
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
          {source.active ? 'Activ' : 'Inactiv'}
        </StatusChip>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-sm text-muted">Ultima sincronizare</dt>
          <dd className="font-semibold">
            {source.lastSyncedAt ? (
              <time dateTime={source.lastSyncedAt}>
                {formatDateTime(source.lastSyncedAt, tenant.timezone)}
              </time>
            ) : (
              'Niciodată'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Excursii</dt>
          <dd className="font-semibold tabular-nums">{source.productCount}</dd>
        </div>
      </dl>
      <div aria-live="polite">
        {result ? (
          <Alert tone="success">
            Sincronizat: {pluralRo(result.products, 'excursie', 'excursii')},{' '}
            {pluralRo(result.slots, 'plecare', 'plecări')}.
          </Alert>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button
        variant="secondary"
        icon={<IconRefresh />}
        onClick={sync}
        loading={busy}
        loadingText="Se sincronizează…"
      >
        Sincronizează acum
      </Button>
    </article>
  );
}

function ConnectForm({ onConnected }: { onConnected: (source: SourceDto) => void }) {
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
    if (!name.trim()) next.name = 'Scrie un nume, ca să-l recunoști în listă.';
    const url = baseUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url))
      next.baseUrl = 'Adresa trebuie să înceapă cu https:// sau http://.';
    if (!token.trim()) next.token = 'Lipsește tokenul de acces.';
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
      setDone(
        source.productCount === 1
          ? `„${source.name}” a fost conectat. Am adus o excursie cu plecările ei.`
          : `„${source.name}” a fost conectat. Am adus ${source.productCount} excursii cu plecările lor.`,
      );
      setName('');
      setBaseUrl('');
      setToken('');
    } catch (err) {
      if (isApiError(err) && err.status === 400) {
        setError(
          'Sistemul tău nu a răspuns cu această adresă și acest token. Verifică-le și încearcă din nou.',
        );
      } else if (isApiError(err) && err.status === 403) {
        setError('Doar proprietarul contului poate conecta un sistem de rezervări.');
      } else {
        setError(errorMessageRo(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Conectează un sistem"
      description="Primești adresa API și tokenul de la firma care îți face programul de rezervări."
    >
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
        <Field
          label="Nume"
          name="name"
          autoComplete="off"
          placeholder="ex. Programul meu de rezervări"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Field
          label="Adresa API"
          name="baseUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://rezervari.exemplu.ro/api"
          required
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          error={errors.baseUrl}
        />
        <Field
          label="Token de acces"
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
        <Button type="submit" size="lg" block loading={busy} loadingText="Se conectează…">
          Conectează
        </Button>
      </form>
    </Card>
  );
}
