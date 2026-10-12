'use client';

import type { TicketDto } from '@ap/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { LoadingBlock } from '@/components/Spinner';
import { DEFAULT_TIMEZONE, formatDateTime } from '@/lib/dates';
import { publicApi } from '@/lib/endpoints';
import { getT, type Lang } from '@/lib/i18n';
import { ticketPath } from '@/lib/links';
import { useApi } from '@/lib/useApi';

/**
 * Fake card form for local development and demos: any input "pays" through
 * POST /public/dev-payments/:bookingId/succeed, then shows the ticket.
 */
export function DevPayForm({
  bookingId,
  ticketKey,
  lang,
}: {
  bookingId: string;
  ticketKey: string;
  lang: Lang;
}) {
  const t = getT(lang);
  const router = useRouter();
  const ticket = useApi<TicketDto>(`dev-pay-ticket:${bookingId}`, (signal) =>
    publicApi.ticket(bookingId, ticketKey, { signal }),
  );
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('12 / 34');
  const [cvc, setCvc] = useState('123');
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await publicApi.devPaymentSucceed(bookingId, ticketKey);
      router.replace(ticketPath(bookingId, ticketKey, lang));
    } catch {
      setError(t.t('payFailed'));
      setBusy(false);
    }
  }

  const paidAlready = ticket.data && ticket.data.status !== 'pending_payment';

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 pt-6">
      <h1 className="text-2xl font-bold">{t.t('devPayTitle')}</h1>
      <Alert tone="warning">{t.t('devPayNote')}</Alert>

      {ticket.loading && !ticket.data ? <LoadingBlock label={t.t('loading')} /> : null}
      {ticket.data ? (
        <div className="rounded-3xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">{ticket.data.tenantName}</p>
          <p className="text-lg font-semibold">{ticket.data.productName}</p>
          <p>{formatDateTime(ticket.data.startsAt, DEFAULT_TIMEZONE, lang)}</p>
          <p className="text-sm text-muted">
            {t.t('reference')}: {ticket.data.bookingReference} ·{' '}
            {t.tp('guestCount', ticket.data.seats)}
          </p>
        </div>
      ) : null}

      {paidAlready ? (
        <Button
          size="lg"
          block
          onClick={() => router.replace(ticketPath(bookingId, ticketKey, lang))}
        >
          {t.t('ticketTitle')}
        </Button>
      ) : (
        <form
          onSubmit={pay}
          noValidate
          className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4"
        >
          <Field
            label={t.t('cardNumber')}
            name="cardnumber"
            inputMode="numeric"
            autoComplete="off"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t.t('expiry')}
              name="exp"
              autoComplete="off"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <Field
              label={t.t('cvc')}
              name="cvc"
              inputMode="numeric"
              autoComplete="off"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
            />
          </div>
          <Field
            label={t.t('cardholder')}
            name="holder"
            autoComplete="off"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" block loading={busy} loadingText={t.t('paying')}>
            {t.t('pay')}
          </Button>
        </form>
      )}
    </div>
  );
}
