'use client';

import type { ContactRequestDto } from '@ap/contracts';
import { useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { IconMail, IconPhone } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip } from '@/components/StatusChip';
import { formatDateTime } from '@/lib/dates';
import { adminApi } from '@/lib/platform-endpoints';
import { errorMessage, useApi } from '@/lib/useApi';

const PLATFORM_TZ = 'Europe/Bucharest';

/** Messages from the contact page: demo requests and questions, unanswered ones first. */
export function ContactAdmin() {
  const i18n = useT();
  const { t } = i18n;
  const requests = useApi('admin-contact', (signal) => adminApi.contactRequests({ signal }));
  const open = (requests.data ?? []).filter((r) => !r.handledAt);
  const done = (requests.data ?? []).filter((r) => r.handledAt);

  function replace(updated: ContactRequestDto) {
    requests.setData((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('admin.contact.title')} description={t('admin.contact.description')} />
      {requests.error ? <Alert tone="error">{errorMessage(requests.error, i18n)}</Alert> : null}
      {requests.loading && !requests.data ? <LoadingBlock /> : null}
      {requests.data ? (
        <>
          <Card title={t('admin.contact.openTitle', { count: open.length })}>
            {open.length === 0 ? (
              <p className="text-muted">{t('admin.contact.noneOpen')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((r) => (
                  <RequestRow key={r.id} request={r} onChanged={replace} />
                ))}
              </ul>
            )}
          </Card>
          {done.length > 0 ? (
            <Card title={t('admin.contact.doneTitle')}>
              <ul className="divide-y divide-line">
                {done.map((r) => (
                  <RequestRow key={r.id} request={r} onChanged={replace} />
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RequestRow({
  request,
  onChanged,
}: {
  request: ContactRequestDto;
  onChanged: (updated: ContactRequestDto) => void;
}) {
  const i18n = useT();
  const { t, lang } = i18n;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link =
    'inline-flex min-h-12 items-center gap-2 rounded-xl px-2 font-semibold text-brand hover:bg-brand-soft';

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await adminApi.setContactHandled(request.id, !request.handledAt));
    } catch (err) {
      setError(errorMessage(err, i18n));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={request.topic === 'demo' ? 'success' : 'neutral'}>
          {request.topic === 'demo' ? t('admin.contact.demo') : t('admin.contact.question')}
        </StatusChip>
        <span className="font-semibold">{request.name}</span>
        {request.company ? <span className="text-muted">· {request.company}</span> : null}
        <span className="ml-auto text-sm text-muted">
          {formatDateTime(request.createdAt, PLATFORM_TZ, lang)}
        </span>
      </div>
      {request.message ? <p className="whitespace-pre-line">{request.message}</p> : null}
      <div className="-mx-2 flex flex-wrap items-center gap-x-2">
        <a href={`mailto:${request.email}`} className={`${link} break-all`}>
          <IconMail size={20} />
          {request.email}
        </a>
        {request.phone ? (
          <a href={`tel:${request.phone}`} className={link}>
            <IconPhone size={20} />
            {request.phone}
          </a>
        ) : null}
        <Button
          variant={request.handledAt ? 'ghost' : 'secondary'}
          className="ml-auto"
          loading={busy}
          loadingText="…"
          onClick={() => void toggle()}
        >
          {request.handledAt ? t('admin.contact.reopen') : t('admin.contact.markHandled')}
        </Button>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
    </li>
  );
}
