'use client';

import type { TicketDto } from '@ap/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { PublicFrame, PublicMessage } from '@/components/public/PublicFrame';
import { QrCode } from '@/components/QrCode';
import { LoadingBlock } from '@/components/Spinner';
import { StatusChip, type Tone } from '@/components/StatusChip';
import { isApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { publicApi } from '@/lib/endpoints';
import type { MessageKey } from '@/lib/i18n';
import { readJson, writeJson } from '@/lib/storage';
import { useWakeLock } from '@/lib/useWakeLock';

const POLL_MS = 3000;

const STATUS: Record<TicketDto['status'], { label: MessageKey; text?: MessageKey; tone: Tone }> = {
  valid: { label: 'ticket.statusValid', tone: 'success' },
  checked_in: { label: 'ticket.statusCheckedIn', text: 'ticket.checkedInText', tone: 'neutral' },
  void: { label: 'ticket.statusVoid', text: 'ticket.voidText', tone: 'danger' },
  pending_payment: { label: 'ticket.statusPending', text: 'ticket.pendingText', tone: 'warning' },
};

/** Copy of the ticket kept on the phone, shown when the network is gone (at sea, in a basement). */
const cacheKey = (bookingId: string) => `ap.ticket.${bookingId}`;

export function TicketView({
  bookingId,
  ticketKey,
}: {
  bookingId: string;
  ticketKey: string;
}) {
  const t = useT();
  const { lang } = t;
  const [ticket, setTicket] = useState<TicketDto | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<'not_found' | 'network' | 'other' | null>(null);
  const [loading, setLoading] = useState(true);
  const statusRef = useRef<TicketDto['status'] | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await publicApi.ticket(bookingId, ticketKey, { signal });
        setTicket(next);
        statusRef.current = next.status;
        setOffline(false);
        setError(null);
        writeJson(cacheKey(bookingId), next);
      } catch (err) {
        if (signal?.aborted) return;
        if (isApiError(err) && (err.isNotFound || err.status === 403 || err.status === 400))
          setError('not_found');
        else if (isApiError(err) && err.isNetwork) {
          setOffline(true);
          setError('network');
        } else setError('other');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [bookingId, ticketKey],
  );

  // Show the saved copy at once, then refresh from the API.
  useEffect(() => {
    const cached = readJson<TicketDto>(cacheKey(bookingId));
    if (cached) {
      setTicket(cached);
      statusRef.current = cached.status;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [bookingId, load]);

  // While the payment is being confirmed, check every few seconds (only while the page is visible).
  const pending = ticket?.status === 'pending_payment';
  useEffect(() => {
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const schedule = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await load(controller.signal);
        if (!controller.signal.aborted && statusRef.current === 'pending_payment') schedule();
      }, POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pending, load]);

  const showQr =
    Boolean(ticket?.qrToken) && (ticket?.status === 'valid' || ticket?.status === 'checked_in');
  useWakeLock(ticket?.status === 'valid');

  if (!ticket) {
    return (
      <PublicFrame>
        {loading ? (
          <LoadingBlock label={t.t('common.loading')} />
        ) : (
          <PublicMessage
            title={
              error === 'not_found'
                ? t.t('ticket.notFound')
                : error === 'network'
                  ? t.t('common.errorNetwork')
                  : t.t('common.errorGeneric')
            }
          >
            {error !== 'not_found' ? (
              <Button variant="secondary" onClick={() => void load()}>
                {t.t('common.retry')}
              </Button>
            ) : null}
          </PublicMessage>
        )}
      </PublicFrame>
    );
  }

  const status = STATUS[ticket.status];

  return (
    <PublicFrame tenantName={ticket.tenantName} branding={ticket.branding}>
      <div className="mx-auto flex max-w-md flex-col gap-5 pt-5">
        {offline ? <Alert tone="warning">{t.t('ticket.offline')}</Alert> : null}

        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">{t.t('ticket.title')}</h1>
          <StatusChip tone={status.tone}>{t.t(status.label)}</StatusChip>
        </header>

        <section
          className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-surface p-5 text-center"
          aria-live="polite"
        >
          {showQr && ticket.qrToken ? (
            <>
              <div
                className={`qr-surface w-full max-w-[20rem] rounded-2xl p-3 ${ticket.status === 'checked_in' ? 'opacity-40' : ''}`}
              >
                <QrCode
                  value={ticket.qrToken}
                  label={t.t('ticket.qrLabel', { reference: ticket.bookingReference })}
                  level="M"
                />
              </div>
              <p className="text-lg font-semibold">
                {ticket.status === 'valid' ? t.t('ticket.showAtBoarding') : t.t('ticket.checkedInText')}
              </p>
            </>
          ) : status.text ? (
            <p className="py-6 text-lg">{t.t(status.text)}</p>
          ) : null}
          <p className="text-sm text-muted">
            {t.t('ticket.referenceLabel')}{' '}
            <span className="font-mono text-base font-semibold text-fg">
              {ticket.bookingReference}
            </span>
          </p>
        </section>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-3xl border border-line bg-surface p-5">
          <div className="col-span-2">
            <dt className="text-sm text-muted">{ticket.tenantName}</dt>
            <dd className="text-lg font-semibold">{ticket.productName}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-sm text-muted">{t.t('ticket.when')}</dt>
            <dd className="text-lg font-semibold">
              <time dateTime={ticket.startsAt}>
                {formatDateTime(ticket.startsAt, ticket.timezone, lang)}
              </time>
            </dd>
          </div>
          {ticket.meetingPoint ? (
            <div className="col-span-2">
              <dt className="text-sm text-muted">{t.t('public.meetingPoint')}</dt>
              <dd className="font-semibold">{ticket.meetingPoint}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-sm text-muted">{t.t('ticket.guests')}</dt>
            <dd className="font-semibold">{t.tp('ticket.guestCount', ticket.seats)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t.t('ticket.bookedBy')}</dt>
            <dd className="font-semibold">{ticket.customerName}</dd>
          </div>
          {ticket.items.length > 0 ? (
            <div className="col-span-2">
              <dt className="text-sm text-muted">{t.t('ticket.tickets')}</dt>
              <dd>
                <ul>
                  {ticket.items.map((item) => (
                    <li key={item.label}>
                      {t.t('ticket.items', { quantity: item.quantity, label: item.label })}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {ticket.status !== 'void' &&
          ticket.paymentMode === 'on_site' &&
          ticket.amountDueOnSiteMinor > 0 ? (
            <div className="col-span-2 border-t border-line pt-3">
              <dt className="text-sm text-muted">{t.t('ticket.dueOnSite')}</dt>
              <dd className="text-xl font-bold">
                <MoneyText
                  amountMinor={ticket.amountDueOnSiteMinor}
                  currency={ticket.currency}
                  lang={lang}
                />
              </dd>
            </div>
          ) : null}
          {(ticket.status === 'valid' || ticket.status === 'checked_in') &&
          ticket.paymentMode === 'online' ? (
            <div className="col-span-2 border-t border-line pt-3">
              <dt className="visually-hidden">{t.t('common.total')}</dt>
              <dd className="font-semibold text-success-fg">{t.t('ticket.paidOnline')}</dd>
            </div>
          ) : null}
        </dl>

        {ticket.status === 'valid' ? <AddToHome /> : null}
      </div>
    </PublicFrame>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Suggests keeping the ticket on the home screen (native install prompt where available). */
function AddToHome() {
  const t = useT();
  const [mode, setMode] = useState<'hidden' | 'ios' | 'other'>('hidden');
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const ua = navigator.userAgent;
    const ios =
      /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    setMode(ios ? 'ios' : 'other');
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setMode('hidden');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (mode === 'hidden') return null;

  return (
    <section
      aria-labelledby="a2hs-title"
      className="no-print flex flex-col gap-2 rounded-3xl bg-surface-2 p-5"
    >
      <h2 id="a2hs-title" className="font-semibold">
        {t.t('ticket.addToHomeTitle')}
      </h2>
      {installEvent ? (
        <Button
          variant="secondary"
          onClick={async () => {
            await installEvent.prompt();
            const choice = await installEvent.userChoice.catch(() => null);
            setInstallEvent(null);
            if (choice?.outcome === 'accepted') setMode('hidden');
          }}
        >
          {t.t('ticket.install')}
        </Button>
      ) : (
        <p className="text-muted">{mode === 'ios' ? t.t('ticket.addToHomeIos') : t.t('ticket.addToHomeOther')}</p>
      )}
    </section>
  );
}
