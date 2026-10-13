'use client';

import { useState, type FormEvent } from 'react';
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
  type WebhookEventType,
} from '@ap/contracts';
import { Alert } from '@/components/Alert';
import { useSession } from '@/components/AuthGate';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import {
  IconCalendarPlus,
  IconCopy,
  IconDownload,
  IconExternal,
  IconPlus,
  IconRefresh,
} from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip, type Tone } from '@/components/StatusChip';
import { API_URL } from '@/lib/api';
import { calendarFeedUrls } from '@/lib/calendar';
import { formatDateTime } from '@/lib/dates';
import { operatorApi } from '@/lib/endpoints';
import type { MessageKey } from '@/lib/i18n';
import { copyText } from '@/lib/share';
import { errorMessage, useApi } from '@/lib/useApi';
import { useOperator } from '../OperatorContext';

const EVENT_LABELS: Record<WebhookEventType | 'webhook.test', MessageKey> = {
  'booking.confirmed': 'integrations.events.bookingConfirmed',
  'booking.paid': 'integrations.events.bookingPaid',
  'booking.cancelled': 'integrations.events.bookingCancelled',
  'ticket.checked_in': 'integrations.events.ticketCheckedIn',
  'webhook.test': 'integrations.events.test',
};

const DELIVERY_STATUS: Record<WebhookDeliveryDto['status'], { label: MessageKey; tone: Tone }> = {
  pending: { label: 'integrations.webhooks.statusPending', tone: 'warning' },
  sending: { label: 'integrations.webhooks.statusSending', tone: 'brand' },
  delivered: { label: 'integrations.webhooks.statusDelivered', tone: 'success' },
  failed: { label: 'integrations.webhooks.statusFailed', tone: 'danger' },
};

/** Connections to the operator's other software: calendar, webhooks, spreadsheet exports. */
export function IntegrationsScreen() {
  const { membership } = useSession();
  const { t } = useT();
  const isOwner = membership.role === 'owner';
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
      <CalendarFeedCard isOwner={isOwner} />
      {isOwner ? (
        <WebhooksSection />
      ) : (
        <Card title={t('integrations.webhooks.title')}>
          <p className="text-muted">{t('integrations.webhooks.ownerOnly')}</p>
        </Card>
      )}
      <Card
        title={t('integrations.exports.title')}
        description={t('integrations.exports.description')}
      >
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/o/bookings" variant="secondary" icon={<IconDownload />}>
            {t('integrations.exports.bookings')}
          </ButtonLink>
          <ButtonLink href="/o/payouts" variant="secondary" icon={<IconDownload />}>
            {t('integrations.exports.commissions')}
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------
// Departures calendar
// -------------------------------------------------------------------------------------------------

function CalendarFeedCard({ isOwner }: { isOwner: boolean }) {
  const { membership } = useSession();
  const i18n = useT();
  const { t, lang } = i18n;
  const feed = useApi(`operator-calendar-feed:${membership.tenantId}`, (signal) =>
    operatorApi.calendarFeed({ signal }),
  );
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const urls = feed.data ? calendarFeedUrls(API_URL, feed.data.token, lang) : null;

  async function copy() {
    if (!urls) return;
    setCopied(await copyText(urls.https));
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      feed.setData(await operatorApi.resetCalendarFeed());
      setNotice(t('integrations.calendar.resetDone'));
      setCopied(false);
      setResetting(false);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t('integrations.calendar.title')}
      description={t('integrations.calendar.description')}
    >
      {feed.loading && !feed.data ? <LoadingBlock label={t('common.loading')} /> : null}
      {feed.error ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" onClick={feed.reload}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(feed.error, i18n)}
        </Alert>
      ) : null}
      {urls ? (
        <div className="flex flex-col gap-3">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <ButtonLink
              href={urls.google}
              external
              target="_blank"
              rel="noopener noreferrer"
              icon={<IconCalendarPlus />}
            >
              {t('integrations.calendar.google')}
            </ButtonLink>
            <ButtonLink href={urls.webcal} external variant="secondary" icon={<IconExternal />}>
              {t('integrations.calendar.appleOutlook')}
            </ButtonLink>
            <Button variant="secondary" icon={<IconCopy />} onClick={copy}>
              {copied ? t('integrations.calendar.copied') : t('integrations.calendar.copy')}
            </Button>
          </div>
          <p className="break-all rounded-2xl bg-surface-2 p-3 font-mono text-sm">{urls.https}</p>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted">
            <li>{t('integrations.calendar.refreshNote')}</li>
            <li>{t('integrations.calendar.privateNote')}</li>
          </ul>
          {isOwner ? (
            <div>
              <Button variant="ghost" icon={<IconRefresh />} onClick={() => setResetting(true)}>
                {t('integrations.calendar.reset')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={resetting}
        onClose={() => setResetting(false)}
        title={t('integrations.calendar.resetTitle')}
        description={t('integrations.calendar.resetDescription')}
      >
        <div className="flex flex-col gap-3">
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => setResetting(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={reset}>
              {t('integrations.calendar.resetConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

// -------------------------------------------------------------------------------------------------
// Webhooks
// -------------------------------------------------------------------------------------------------

function WebhooksSection() {
  const { membership } = useSession();
  const i18n = useT();
  const { t } = i18n;
  const endpoints = useApi(`operator-webhooks:${membership.tenantId}`, (signal) =>
    operatorApi.webhooks({ signal }),
  );
  const [created, setCreated] = useState<{ url: string; secret: string } | null>(null);

  const replace = (updated: WebhookEndpointDto) =>
    endpoints.setData((prev) => (prev ?? []).map((e) => (e.id === updated.id ? updated : e)));

  return (
    <section aria-labelledby="webhooks-title" className="flex flex-col gap-3">
      <div>
        <h2 id="webhooks-title" className="text-xl font-semibold">
          {t('integrations.webhooks.title')}
        </h2>
        <p className="text-muted">{t('integrations.webhooks.description')}</p>
      </div>
      <Alert tone="info">{t('integrations.webhooks.zapierHelp')}</Alert>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {endpoints.loading && !endpoints.data ? (
            <LoadingBlock label={t('common.loading')} />
          ) : null}
          {endpoints.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={endpoints.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(endpoints.error, i18n)}
            </Alert>
          ) : null}
          {created ? (
            <Alert tone="success">
              <span className="flex flex-col gap-2">
                <span>{t('integrations.webhooks.createdNotice', { url: created.url })}</span>
                <SecretBox secret={created.secret} />
              </span>
            </Alert>
          ) : null}
          {endpoints.data && endpoints.data.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 p-3 text-muted">
              {t('integrations.webhooks.none')}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {(endpoints.data ?? []).map((endpoint) => (
              <li key={endpoint.id}>
                <EndpointCard
                  endpoint={endpoint}
                  onChanged={replace}
                  onDeleted={() =>
                    endpoints.setData((prev) => (prev ?? []).filter((e) => e.id !== endpoint.id))
                  }
                />
              </li>
            ))}
          </ul>
        </div>
        <AddWebhookForm
          onCreated={(endpoint, secret) => {
            endpoints.setData((prev) => [...(prev ?? []), endpoint]);
            setCreated({ url: endpoint.url, secret });
          }}
        />
      </div>
    </section>
  );
}

function SecretBox({ secret }: { secret: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex flex-col gap-2">
      <code className="break-all rounded-xl bg-surface p-2 font-mono text-sm text-fg">
        {secret}
      </code>
      <span className="text-sm">{t('integrations.webhooks.secretHelp')}</span>
      <span>
        <Button
          variant="secondary"
          icon={<IconCopy />}
          onClick={async () => setCopied(await copyText(secret))}
        >
          {copied ? t('integrations.webhooks.secretCopied') : t('integrations.webhooks.copySecret')}
        </Button>
      </span>
    </span>
  );
}

function EventsChooser({
  value,
  onChange,
}: {
  /** Empty: every event. */
  value: WebhookEventType[];
  onChange: (value: WebhookEventType[]) => void;
}) {
  const { t } = useT();
  const checked = (type: WebhookEventType) => value.length === 0 || value.includes(type);
  function toggle(type: WebhookEventType, on: boolean) {
    const current = value.length === 0 ? [...WEBHOOK_EVENT_TYPES] : value;
    const next = on ? [...current, type] : current.filter((e) => e !== type);
    // Every event ticked is stored as "all", so events added later reach this address too.
    onChange(next.length === WEBHOOK_EVENT_TYPES.length ? [] : next);
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 font-semibold">{t('integrations.webhooks.events')}</legend>
      {WEBHOOK_EVENT_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-3 rounded-2xl border border-line p-3">
          <input
            type="checkbox"
            className="size-6 shrink-0"
            checked={checked(type)}
            disabled={checked(type) && value.length === 1}
            onChange={(e) => toggle(type, e.target.checked)}
          />
          <span className="font-semibold">{t(EVENT_LABELS[type])}</span>
        </label>
      ))}
    </fieldset>
  );
}

function AddWebhookForm({
  onCreated,
}: {
  onCreated: (endpoint: WebhookEndpointDto, secret: string) => void;
}) {
  const i18n = useT();
  const { t } = i18n;
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = url.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setUrlError(t('integrations.webhooks.errUrl'));
      return;
    }
    setUrlError(null);
    setBusy(true);
    setError(null);
    try {
      const result = await operatorApi.createWebhook({
        url: value,
        description: description.trim() || null,
        events,
      });
      onCreated(result.endpoint, result.secret);
      setUrl('');
      setDescription('');
      setEvents([]);
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t('integrations.webhooks.addTitle')}
      description={t('integrations.webhooks.addDescription')}
    >
      <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
        <Field
          label={t('integrations.webhooks.url')}
          hint={t('integrations.webhooks.urlHint')}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={urlError ?? undefined}
        />
        <Field
          label={t('integrations.webhooks.name')}
          hint={t('integrations.webhooks.nameHint')}
          optionalText={t('common.optional')}
          name="description"
          autoComplete="off"
          maxLength={120}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <EventsChooser value={events} onChange={setEvents} />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button
          type="submit"
          icon={<IconPlus />}
          loading={busy}
          loadingText={t('integrations.webhooks.adding')}
        >
          {t('integrations.webhooks.add')}
        </Button>
      </form>
    </Card>
  );
}

function EndpointCard({
  endpoint,
  onChanged,
  onDeleted,
}: {
  endpoint: WebhookEndpointDto;
  onChanged: (endpoint: WebhookEndpointDto) => void;
  onDeleted: () => void;
}) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, lang } = i18n;
  const [busy, setBusy] = useState<'test' | 'toggle' | 'secret' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingEvents, setEditingEvents] = useState(false);

  async function run<T>(kind: NonNullable<typeof busy>, action: () => Promise<T>) {
    setBusy(kind);
    setMessage(null);
    try {
      return await action();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err, i18n) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    const result = await run('test', () => operatorApi.testWebhook(endpoint.id));
    if (!result) return;
    setMessage(
      result.ok
        ? {
            tone: 'success',
            text: t('integrations.webhooks.testOk', { status: result.status ?? '' }),
          }
        : {
            tone: 'error',
            text: t('integrations.webhooks.testFailed', { error: result.error ?? '' }),
          },
    );
    onChanged({
      ...endpoint,
      lastAttemptAt: new Date().toISOString(),
      lastStatus: result.status,
      lastError: result.ok ? null : result.error,
    });
  }

  async function toggle() {
    const updated = await run('toggle', () =>
      operatorApi.updateWebhook(endpoint.id, { active: !endpoint.active }),
    );
    if (updated) onChanged(updated);
  }

  async function saveEvents(events: WebhookEventType[]) {
    const updated = await run('toggle', () => operatorApi.updateWebhook(endpoint.id, { events }));
    if (updated) onChanged(updated);
  }

  async function reveal() {
    if (secret) {
      setSecret(null);
      return;
    }
    const result = await run('secret', () => operatorApi.webhookSecret(endpoint.id));
    if (result) setSecret(result.secret);
  }

  const lastOk = endpoint.lastAttemptAt && !endpoint.lastError;
  return (
    <article className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">
            {endpoint.description || t('integrations.webhooks.unnamed')}
          </h3>
          <p className="break-all text-sm text-muted">{endpoint.url}</p>
        </div>
        <StatusChip tone={endpoint.active ? 'success' : 'neutral'}>
          {endpoint.active ? t('integrations.webhooks.active') : t('integrations.webhooks.off')}
        </StatusChip>
      </div>

      <p className="text-sm">
        <span className="font-semibold">{t('integrations.webhooks.sends')}</span>{' '}
        {endpoint.events.length === 0
          ? t('integrations.webhooks.allEvents')
          : endpoint.events.map((e) => t(EVENT_LABELS[e])).join(', ')}{' '}
        <button
          type="button"
          className="font-semibold text-brand underline underline-offset-2"
          onClick={() => setEditingEvents((v) => !v)}
        >
          {t('integrations.webhooks.change')}
        </button>
      </p>
      {editingEvents ? <EventsChooser value={endpoint.events} onChange={saveEvents} /> : null}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">{t('integrations.webhooks.lastAttempt')}</dt>
          <dd className="font-semibold">
            {endpoint.lastAttemptAt ? (
              <>
                <time dateTime={endpoint.lastAttemptAt}>
                  {formatDateTime(endpoint.lastAttemptAt, tenant.timezone, lang)}
                </time>{' '}
                <StatusChip tone={lastOk ? 'success' : 'danger'}>
                  {lastOk
                    ? t('integrations.webhooks.lastOk')
                    : t('integrations.webhooks.lastFailed')}
                </StatusChip>
              </>
            ) : (
              t('integrations.webhooks.never')
            )}
          </dd>
          {endpoint.lastError ? (
            <dd className="break-words text-danger-fg">{endpoint.lastError}</dd>
          ) : null}
        </div>
        <div>
          <dt className="text-muted">{t('integrations.webhooks.queue')}</dt>
          <dd className="font-semibold">
            {t('integrations.webhooks.queueCounts', {
              pending: endpoint.pending,
              failed: endpoint.failed,
            })}
          </dd>
        </div>
      </dl>

      <div aria-live="polite">
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </div>
      {secret ? (
        <Alert tone="info">
          <SecretBox secret={secret} />
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={test}
          loading={busy === 'test'}
          loadingText={t('integrations.webhooks.testing')}
        >
          {t('integrations.webhooks.test')}
        </Button>
        <Button variant="secondary" onClick={() => setShowHistory((v) => !v)}>
          {showHistory
            ? t('integrations.webhooks.hideHistory')
            : t('integrations.webhooks.history')}
        </Button>
        <Button variant="secondary" onClick={reveal} loading={busy === 'secret'}>
          {secret ? t('integrations.webhooks.hideSecret') : t('integrations.webhooks.showSecret')}
        </Button>
        <Button variant="secondary" onClick={toggle} loading={busy === 'toggle'}>
          {endpoint.active ? t('integrations.webhooks.turnOff') : t('integrations.webhooks.turnOn')}
        </Button>
        <Button variant="ghost" onClick={() => setDeleting(true)}>
          {t('integrations.webhooks.delete')}
        </Button>
      </div>

      {showHistory ? <DeliveryHistory endpoint={endpoint} /> : null}

      <Dialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t('integrations.webhooks.deleteTitle')}
        description={t('integrations.webhooks.deleteDescription', { url: endpoint.url })}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setDeleting(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy === 'delete'}
            onClick={async () => {
              const done = await run('delete', async () => {
                await operatorApi.deleteWebhook(endpoint.id);
                return true;
              });
              setDeleting(false);
              if (done) onDeleted();
            }}
          >
            {t('integrations.webhooks.deleteConfirm')}
          </Button>
        </div>
      </Dialog>
    </article>
  );
}

function DeliveryHistory({ endpoint }: { endpoint: WebhookEndpointDto }) {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t, lang } = i18n;
  const deliveries = useApi(`operator-webhook-deliveries:${endpoint.id}`, (signal) =>
    operatorApi.webhookDeliveries(endpoint.id, { signal }),
  );
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function retry(delivery: WebhookDeliveryDto) {
    setRetrying(delivery.id);
    setError(null);
    try {
      const updated = await operatorApi.retryWebhookDelivery(endpoint.id, delivery.id);
      deliveries.setData((prev) => (prev ?? []).map((d) => (d.id === updated.id ? updated : d)));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section aria-label={t('integrations.webhooks.history')} className="flex flex-col gap-2">
      {deliveries.loading && !deliveries.data ? <LoadingBlock label={t('common.loading')} /> : null}
      {deliveries.error ? <Alert tone="error">{errorMessage(deliveries.error, i18n)}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {deliveries.data && deliveries.data.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">
          {t('integrations.webhooks.historyEmpty')}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
        {(deliveries.data ?? []).map((d) => {
          const status = DELIVERY_STATUS[d.status];
          const label = EVENT_LABELS[d.eventType as WebhookEventType] ?? null;
          return (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{label ? t(label) : d.eventType}</span>
                <time dateTime={d.createdAt} className="text-muted">
                  {formatDateTime(d.createdAt, tenant.timezone, lang)}
                </time>
                {d.lastError ? (
                  <span className="break-words text-danger-fg">{d.lastError}</span>
                ) : null}
              </span>
              <span className="flex items-center gap-2">
                <StatusChip tone={status.tone}>{t(status.label)}</StatusChip>
                {d.status === 'failed' ? (
                  <Button variant="secondary" loading={retrying === d.id} onClick={() => retry(d)}>
                    {t('integrations.webhooks.retry')}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
