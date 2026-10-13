'use client';

import type { TicketDto } from '@ap/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { LoadingBlock } from '@/components/Spinner';
import { formatDateTime } from '@/lib/dates';
import { publicApi } from '@/lib/endpoints';
import { ticketPath } from '@/lib/links';
import { useApi } from '@/lib/useApi';

/**
 * Fake card form for local development and demos: any input "pays" through
 * POST /public/dev-payments/:bookingId/succeed, then shows the ticket.
 */
export function DevPayForm({ bookingId, ticketKey }: { bookingId: string; ticketKey: string }) {
  const t = useT();
  const { lang } = t;
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
      setError(t.t('public.payFailed'));
      setBusy(false);
    }
  }

  const paidAlready = ticket.data && ticket.data.status !== 'pending_payment';

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 pt-6">
      <h1 className="text-2xl font-bold">{t.t('public.devPayTitle')}</h1>
      <Alert tone="warning">{t.t('public.devPayNote')}</Alert>

      {ticket.loading && !ticket.data ? <LoadingBlock label={t.t('common.loading')} /> : null}
      {ticket.data ? (
        <div className="rounded-3xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">{ticket.data.tenantName}</p>
          <p className="text-lg font-semibold">{ticket.data.productName}</p>
          <p>{formatDateTime(ticket.data.startsAt, ticket.data.timezone, lang)}</p>
          <p className="text-sm text-muted">
            {t.t('ticket.referenceLabel')} {ticket.data.bookingReference} ·{' '}
            {t.tp('ticket.guestCount', ticket.data.seats)}
          </p>
        </div>
      ) : null}

      {paidAlready ? (
        <Button
          size="lg"
          block
          onClick={() => router.replace(ticketPath(bookingId, ticketKey, lang))}
        >
          {t.t('ticket.title')}
        </Button>
      ) : (
        <form
          onSubmit={pay}
          noValidate
          className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4"
        >
          <Field
            label={t.t('public.cardNumber')}
            name="cardnumber"
            inputMode="numeric"
            autoComplete="off"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t.t('public.expiry')}
              name="exp"
              autoComplete="off"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
            <Field
              label={t.t('public.cvc')}
              name="cvc"
              inputMode="numeric"
              autoComplete="off"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
            />
          </div>
          <Field
            label={t.t('public.cardholder')}
            name="holder"
            autoComplete="off"
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
          />
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Button type="submit" size="lg" block loading={busy} loadingText={t.t('public.paying')}>
            {t.t('public.pay')}
          </Button>
        </form>
      )}
    </div>
  );
}
