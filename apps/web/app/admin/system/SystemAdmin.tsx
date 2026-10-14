'use client';

import type { AdminSystemDto, DeadEventDto } from '@ap/contracts';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { formatDateTime } from '@/lib/dates';
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessage, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

/** Whether the background worker runs, and internal events that stopped being retried. */
export function SystemAdmin() {
  const i18n = useT();
  const { t, lang } = i18n;
  const system = useApi('admin-system', (signal) => adminApi.system({ signal }));
  const worker = system.data?.worker;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('admin.system.title')} description={t('admin.system.description')} />
      {system.error ? <Alert tone="error">{errorMessage(system.error, i18n)}</Alert> : null}
      {system.loading && !system.data ? <LoadingBlock /> : null}
      {worker ? (
        <Card title={t('admin.system.workerTitle')}>
          <div className="flex flex-col gap-3">
            {worker.status === 'ok' ? (
              <Alert tone="success">{t('admin.system.workerOk')}</Alert>
            ) : (
              <Alert tone="error">
                {worker.status === 'unknown'
                  ? t('admin.system.workerUnknown')
                  : t('admin.system.workerStale')}
              </Alert>
            )}
            <ul className="divide-y divide-line">
              {worker.jobs.map((job) => (
                <li key={job.job} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="font-semibold">{job.job}</span>
                  <StatusChip tone={job.stale ? 'danger' : job.lastError ? 'warning' : 'success'}>
                    {job.stale
                      ? t('admin.system.jobStale')
                      : job.lastError
                        ? t('admin.system.jobFailed')
                        : t('admin.system.jobOk')}
                  </StatusChip>
                  <span className="ml-auto text-sm text-muted">
                    {job.lastRunAt
                      ? t('admin.system.lastRun', {
                          when: formatDateTime(job.lastRunAt, PLATFORM_TZ, lang),
                        })
                      : t('admin.system.neverRun')}
                  </span>
                  {job.lastError ? (
                    <p className="w-full break-words text-sm text-muted">{job.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
      {system.data ? (
        <Card title={t('admin.system.eventsTitle', { count: system.data.deadEvents.length })}>
          {system.data.deadEvents.length === 0 ? (
            <p className="text-muted">{t('admin.system.noEvents')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-muted">{t('admin.system.eventsHelp')}</p>
              <ul className="divide-y divide-line">
                {system.data.deadEvents.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    onRetried={(next: AdminSystemDto) => system.setData(next)}
                  />
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  onRetried,
}: {
  event: DeadEventDto;
  onRetried: (next: AdminSystemDto) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      onRetried(await adminApi.retryEvent(event.id));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="danger">{event.type}</StatusChip>
        <span className="font-semibold">{event.tenantName ?? t('admin.system.noOperator')}</span>
        <span className="ml-auto text-sm text-muted">
          {formatDateTime(event.occurredAt, PLATFORM_TZ, lang)}
        </span>
      </div>
      <p className="break-words text-sm text-muted">
        {t('admin.system.attempts', { count: event.attempts })}
        {event.lastError ? ` · ${event.lastError}` : ''}
      </p>
      <div>
        <Button variant="secondary" loading={busy} loadingText="…" onClick={() => void retry()}>
          {t('admin.system.retry')}
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}
