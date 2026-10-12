'use client';

import type { TicketDto } from '@ap/contracts';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { IconAlert, IconCamera, IconCheck, IconScan, IconX } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { Spinner } from '@/components/Spinner';
import { isApiError } from '@/lib/api';
import { dateKeyInTz, formatDayLong, formatTime, todayKey } from '@/lib/dates';
import { operatorApi, publicApi } from '@/lib/endpoints';
import { parseTicketUrl } from '@/lib/links';
import { formatMoney } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import { errorMessage } from '@/lib/useApi';
import { useT } from '@/components/I18nProvider';
import { useOperator } from '../OperatorContext';
import { createQrDecoder, looksLikeToken, type QrDecoder } from './qrDecoder';

type CameraState = 'idle' | 'starting' | 'on' | 'denied' | 'unavailable' | 'error';

type Outcome =
  | {
      kind: 'checked_in' | 'already_checked_in' | 'not_valid';
      ticket: TicketDto | null;
      collectMinor: number | null;
    }
  | { kind: 'error'; message: string; input: string };

/** Same code seen again within this window is ignored (the QR is often still in front of the camera). */
const REPEAT_WINDOW_MS = 5000;
const SCAN_INTERVAL_MS = 180;

export function ScanScreen() {
  const { tenant } = useOperator();
  const i18n = useT();
  const { t } = i18n;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderRef = useRef<QrDecoder | null>(null);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const aliveRef = useRef(true);

  const [camera, setCamera] = useState<CameraState>('idle');
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!aliveRef.current) {
        // The page was left while the permission prompt was open.
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (!decoderRef.current) decoderRef.current = (await createQrDecoder()).decode;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setCamera('on');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setCamera('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError')
        setCamera('unavailable');
      else setCamera('error');
    }
  }, []);

  // Start straight away when the camera permission was already given; otherwise wait for a tap.
  useEffect(() => {
    let cancelled = false;
    aliveRef.current = true;
    try {
      navigator.permissions
        ?.query({ name: 'camera' as PermissionName })
        .then((status) => {
          if (!cancelled && status.state === 'granted') void startCamera();
        })
        .catch(() => undefined);
    } catch {
      // Permissions API without "camera" (Firefox): wait for the tap.
    }
    return () => {
      cancelled = true;
      aliveRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  /** Turns scanned or pasted text into a ticket token (a ticket link is resolved through the API). */
  const resolveToken = useCallback(async (input: string): Promise<string | null> => {
    const text = input.trim();
    const ticketLink =
      /^https?:\/\//i.test(text) || text.startsWith('/t/') ? parseTicketUrl(text) : null;
    if (ticketLink) {
      const ticket = await publicApi.ticket(ticketLink.bookingId, ticketLink.key);
      return ticket.qrToken;
    }
    return looksLikeToken(text) ? text : null;
  }, []);

  const check = useCallback(
    async (input: string) => {
      setChecking(true);
      setOutcome(null);
      try {
        const token = await resolveToken(input);
        if (!token) {
          setOutcome({ kind: 'not_valid', ticket: null, collectMinor: null });
        } else {
          const result = await operatorApi.checkIn({ token });
          const collectMinor = result.collectMinor > 0 ? result.collectMinor : null;
          setOutcome({ kind: result.result, ticket: result.ticket, collectMinor });
          try {
            navigator.vibrate?.(result.result === 'checked_in' ? 120 : [90, 60, 90, 60, 220]);
          } catch {
            // Vibration is optional.
          }
        }
      } catch (err) {
        const message =
          isApiError(err) && err.isNotFound ? t('catalog.scan.notFound') : errorMessage(err, i18n);
        setOutcome({ kind: 'error', message, input });
      } finally {
        setChecking(false);
      }
    },
    [resolveToken, t, i18n],
  );

  // Decode frames while the camera is on and no result is waiting to be read.
  const scanning = camera === 'on' && !checking && outcome === null;
  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const video = videoRef.current;
      const decode = decoderRef.current;
      if (stopped) return;
      if (video && decode && video.readyState >= 2) {
        try {
          const value = await decode(video);
          if (stopped) return;
          if (value) {
            const now = Date.now();
            const last = lastRef.current;
            if (!last || last.value !== value || now - last.at > REPEAT_WINDOW_MS) {
              lastRef.current = { value, at: now };
              void check(value);
              return;
            }
            lastRef.current = { value, at: now };
          }
        } catch {
          // A frame that cannot be read; try the next one.
        }
      }
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    };
    void videoRef.current?.play().catch(() => undefined);
    timer = setTimeout(tick, SCAN_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [scanning, check]);

  useEffect(() => {
    if (outcome) resultHeadingRef.current?.focus();
  }, [outcome]);

  function next() {
    // Keep remembering the last code so the same ticket is not re-read the moment scanning resumes.
    if (lastRef.current) lastRef.current = { ...lastRef.current, at: Date.now() };
    setOutcome(null);
    setManual('');
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = manual.trim();
    if (!text) {
      setManualError(t('catalog.scan.manualEmpty'));
      return;
    }
    setManualError(null);
    void check(text);
  }

  const showVideo = camera === 'on' || camera === 'starting';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('catalog.scan.title')} description={t('catalog.scan.description')} />

      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div
          className={
            showVideo && !outcome && !checking
              ? 'relative aspect-square overflow-hidden rounded-3xl bg-black'
              : 'pointer-events-none relative h-0 overflow-hidden'
          }
        >
          <video
            ref={videoRef}
            className="size-full object-cover"
            playsInline
            muted
            autoPlay
            aria-label={t('catalog.scan.cameraVideo')}
          />
          {camera === 'on' ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[14%] rounded-3xl border-4 border-white/85 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Spinner label={t('catalog.scan.cameraStarting')} />
            </div>
          )}
        </div>

        {checking ? (
          <div
            role="status"
            className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border border-line bg-surface p-6"
          >
            <Spinner size={40} />
            <p className="text-lg font-semibold">{t('catalog.scan.checking')}</p>
          </div>
        ) : null}

        {outcome ? (
          <ResultPanel
            outcome={outcome}
            timezone={tenant.timezone}
            currency={tenant.currency}
            headingRef={resultHeadingRef}
            onNext={next}
            onRetry={outcome.kind === 'error' ? () => void check(outcome.input) : undefined}
          />
        ) : null}

        {!showVideo && !outcome && !checking ? (
          <CameraPrompt state={camera} onStart={() => void startCamera()} />
        ) : null}

        <details className="rounded-3xl border border-line bg-surface p-4">
          <summary className="flex min-h-12 cursor-pointer items-center font-semibold">
            {t('catalog.scan.manualSummary')}
          </summary>
          <form onSubmit={submitManual} noValidate className="mt-3 flex flex-col gap-3">
            <Field
              label={t('catalog.scan.manualLabel')}
              hint={t('catalog.scan.manualHint')}
              name="ticket"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              error={manualError}
            />
            <Button type="submit" variant="secondary" disabled={checking}>
              {t('catalog.scan.checkTicket')}
            </Button>
          </form>
        </details>
      </div>
    </div>
  );
}

function CameraPrompt({ state, onStart }: { state: CameraState; onStart: () => void }) {
  const { t } = useT();
  if (state === 'denied') {
    return (
      <Alert tone="warning" title={t('catalog.scan.deniedTitle')}>
        {t('catalog.scan.deniedBody')}
        <div className="mt-3">
          <Button icon={<IconCamera />} onClick={onStart}>
            {t('common.retry')}
          </Button>
        </div>
      </Alert>
    );
  }
  if (state === 'unavailable') {
    return (
      <Alert tone="warning" title={t('catalog.scan.unavailableTitle')}>
        {t('catalog.scan.unavailableBody')}
      </Alert>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-line bg-surface p-6 text-center">
      <IconScan size={48} className="text-brand" />
      <p className="text-muted">{t('catalog.scan.intro')}</p>
      {state === 'error' ? <Alert tone="error">{t('catalog.scan.cameraError')}</Alert> : null}
      <Button size="xl" block icon={<IconCamera />} onClick={onStart}>
        {t('catalog.scan.startCamera')}
      </Button>
    </div>
  );
}

const OUTCOME_STYLE = {
  checked_in: {
    title: 'catalog.scan.outcome.checkedIn',
    box: 'bg-success text-on-success',
    Icon: IconCheck,
  },
  already_checked_in: {
    title: 'catalog.scan.outcome.alreadyCheckedIn',
    box: 'bg-warning text-on-warning',
    Icon: IconAlert,
  },
  not_valid: {
    title: 'catalog.scan.outcome.notValid',
    box: 'bg-danger text-on-danger',
    Icon: IconX,
  },
  error: {
    title: 'catalog.scan.outcome.error',
    box: 'bg-danger text-on-danger',
    Icon: IconAlert,
  },
} as const;

function notValidReason(ticket: TicketDto | null, t: Translator['t']): string {
  if (!ticket) return t('catalog.scan.reasonUnknown');
  if (ticket.status === 'pending_payment') return t('catalog.scan.reasonUnpaid');
  return t('catalog.scan.reasonCancelled');
}

function ResultPanel({
  outcome,
  timezone,
  currency,
  headingRef,
  onNext,
  onRetry,
}: {
  outcome: Outcome;
  timezone: string;
  currency: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onNext: () => void;
  onRetry?: () => void;
}) {
  const { t, lang } = useT();
  const style = OUTCOME_STYLE[outcome.kind];
  const ticket = outcome.kind === 'error' ? null : outcome.ticket;
  const otherDay = ticket && dateKeyInTz(ticket.startsAt, timezone) !== todayKey(timezone);

  return (
    <section
      role={outcome.kind === 'checked_in' ? 'status' : 'alert'}
      aria-labelledby="scan-result"
      className="overflow-hidden rounded-3xl border border-line bg-surface"
    >
      <div className={`flex items-center gap-3 p-5 ${style.box}`}>
        <style.Icon size={44} className="shrink-0" />
        <h2
          id="scan-result"
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold outline-none"
        >
          {t(style.title)}
        </h2>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {outcome.kind === 'error' ? <p>{outcome.message}</p> : null}
        {outcome.kind === 'not_valid' ? (
          <p className="text-lg">{notValidReason(ticket, t)}</p>
        ) : null}

        {outcome.kind === 'checked_in' && ticket?.paymentMode === 'on_site' ? (
          <div className="rounded-2xl border-2 border-warning bg-warning-soft p-4 text-warning-fg">
            <p className="font-semibold">{t('catalog.scan.payOnSite')}</p>
            {outcome.collectMinor !== null ? (
              <p className="text-3xl font-bold">
                {t('catalog.scan.collect', {
                  amount: formatMoney(outcome.collectMinor, currency, lang),
                })}
              </p>
            ) : (
              <p className="text-lg">{t('catalog.scan.collectTotal')}</p>
            )}
          </div>
        ) : null}

        {otherDay && ticket ? (
          <Alert tone="warning">
            {t('catalog.scan.otherDay', {
              day: formatDayLong(dateKeyInTz(ticket.startsAt, timezone), lang),
            })}
          </Alert>
        ) : null}

        {ticket ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2">
              <dt className="text-sm text-muted">{t('catalog.scan.customer')}</dt>
              <dd className="text-xl font-semibold">{ticket.customerName}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-sm text-muted">{t('catalog.scan.trip')}</dt>
              <dd className="font-semibold">
                {ticket.productName} · {formatTime(ticket.startsAt, timezone, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('catalog.scan.seats')}</dt>
              <dd className="text-xl font-semibold">{ticket.seats}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('catalog.scan.reference')}</dt>
              <dd className="font-semibold">{ticket.bookingReference}</dd>
            </div>
            {ticket.items.length > 0 ? (
              <div className="col-span-2">
                <dt className="text-sm text-muted">{t('catalog.scan.tickets')}</dt>
                <dd>
                  <ul>
                    {ticket.items.map((item) => (
                      <li key={item.label}>
                        {t('catalog.scan.itemLine', {
                          quantity: item.quantity,
                          label: item.label,
                        })}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="flex flex-col gap-2">
          {onRetry ? (
            <Button size="lg" block variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : null}
          <Button size="xl" block icon={<IconScan />} onClick={onNext}>
            {t('catalog.scan.next')}
          </Button>
        </div>
      </div>
    </section>
  );
}
