'use client';

import type { ProductDto, PublicCheckoutBody, SlotDto } from '@ap/contracts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { MoneyText } from '@/components/MoneyText';
import { SlotPicker } from '@/components/booking/SlotPicker';
import { TicketQuantities } from '@/components/booking/TicketQuantities';
import { LoadingBlock } from '@/components/Spinner';
import { StickyActions } from '@/components/StickyActions';
import { isApiError } from '@/lib/api';
import {
  defaultQuantities,
  groupSlotsByDay,
  seatsNeeded,
  ticketCount,
  toItems,
  totalMinor,
  upcomingSlots,
  type Quantities,
} from '@/lib/booking';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { nextDays } from '@/lib/dates';
import { publicApi } from '@/lib/endpoints';
import { formatMoney } from '@/lib/format';
import { getT, type Lang } from '@/lib/i18n';
import {
  parseTicketUrl,
  readCookie,
  REF_COOKIE,
  SOURCE_COOKIE,
  ticketPath,
  VISITOR_COOKIE,
} from '@/lib/links';
import { useApi } from '@/lib/useApi';

const REF_RE = /^[A-Za-z0-9_-]{1,32}$/;

interface DetailErrors {
  name?: string;
  contact?: string;
  email?: string;
  phone?: string;
}

/** Attribution read from the cookies set by `/r/[code]`. */
function attribution(): Pick<PublicCheckoutBody, 'ref' | 'refSource' | 'visitorId'> {
  const ref = readCookie(REF_COOKIE);
  const source = readCookie(SOURCE_COOKIE);
  const visitorId = readCookie(VISITOR_COOKIE);
  const out: Pick<PublicCheckoutBody, 'ref' | 'refSource' | 'visitorId'> = {};
  if (ref && REF_RE.test(ref)) {
    out.ref = ref;
    if (source === 'qr' || source === 'link') out.refSource = source;
  }
  if (visitorId) out.visitorId = visitorId.slice(0, 64);
  return out;
}

/** Where to send the customer after checkout. Our own pages keep the chosen language. */
function nextLocation(paymentUrl: string | null, ticketUrl: string, lang: Lang): string {
  if (paymentUrl) {
    try {
      const url = new URL(paymentUrl, window.location.href);
      if (url.origin === window.location.origin && url.pathname.startsWith('/dev/pay/')) {
        url.searchParams.set('lang', lang);
        return url.toString();
      }
    } catch {
      // Not a URL we can parse: use it as is.
    }
    return paymentUrl;
  }
  const ticket = parseTicketUrl(ticketUrl);
  return ticket ? ticketPath(ticket.bookingId, ticket.key, lang) : ticketUrl;
}

export function PublicBookingForm({
  tenantSlug,
  product,
  timezone,
  lang,
}: {
  tenantSlug: string;
  product: ProductDto;
  timezone: string;
  lang: Lang;
}) {
  const t = getT(lang);
  const days = useMemo(() => nextDays(14, timezone), [timezone]);
  const slots = useApi(`public-slots:${tenantSlug}:${product.slug}`, (signal) =>
    publicApi.slots(
      tenantSlug,
      product.slug,
      { from: days[0], to: days[days.length - 1] },
      { signal },
    ),
  );
  const upcoming = useMemo(() => upcomingSlots(slots.data ?? []), [slots.data]);

  const [date, setDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const slot: SlotDto | null = upcoming.find((s) => s.id === slotId) ?? null;
  const [quantities, setQuantities] = useState<Quantities>({});

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [slotError, setSlotError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [errors, setErrors] = useState<DetailErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Preselect the first day that still has seats once departures arrive.
  useEffect(() => {
    if (!slots.data) return;
    const byDay = groupSlotsByDay(upcoming, timezone);
    const first = days.find((d) => (byDay.get(d) ?? []).some((s) => s.available > 0));
    setDate((current) => current ?? first ?? days[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.data]);

  // After a failed submit, move focus to the first field that needs attention.
  useEffect(() => {
    if (attempt === 0) return;
    const target = formRef.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [role="alert"]',
    );
    if (target) {
      target.scrollIntoView({ block: 'center' });
      if (target.matches('input, select, textarea')) target.focus();
    }
  }, [attempt]);

  function chooseSlot(next: SlotDto) {
    setSlotId(next.id);
    setSlotError(null);
    setTicketError(null);
    if (ticketCount(quantities) === 0)
      setQuantities(defaultQuantities(product.prices, next.available));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSubmitError(null);

    const cleanPhone = phone.trim() ? normalizePhone(phone) : '';
    const cleanEmail = email.trim() ? normalizeEmail(email) : '';
    const nextErrors: DetailErrors = {};
    if (!name.trim()) nextErrors.name = t.t('errorName');
    if (cleanEmail && !isValidEmail(cleanEmail)) nextErrors.email = t.t('errorEmail');
    if (cleanPhone && !isValidPhone(cleanPhone)) nextErrors.phone = t.t('errorPhone');
    if (!cleanEmail && !cleanPhone) nextErrors.contact = t.t('errorContact');

    const missingSlot = !slot ? t.t('chooseTimeFirst') : null;
    const ticketProblem = !slot
      ? null
      : ticketCount(quantities) === 0
        ? t.t('selectTickets')
        : seatsNeeded(product.prices, quantities) > slot.available
          ? t.tp('notEnoughSeats', slot.available)
          : null;

    setSlotError(missingSlot);
    setTicketError(ticketProblem);
    setErrors(nextErrors);
    if (missingSlot || ticketProblem || Object.keys(nextErrors).length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    if (!slot) return;

    setBusy(true);
    try {
      const result = await publicApi.checkout(tenantSlug, {
        slotId: slot.id,
        items: toItems(quantities),
        customer: {
          name: name.trim(),
          email: cleanEmail || undefined,
          phone: cleanPhone || undefined,
          locale: lang,
        },
        ...attribution(),
      });
      window.location.assign(nextLocation(result.paymentUrl, result.ticketUrl, lang));
      // Keep the button busy while the browser navigates away.
    } catch (err) {
      setBusy(false);
      if (isApiError(err) && err.status === 409) {
        setSubmitError(t.t('slotGone'));
        setSlotId(null);
        slots.reload();
      } else if (isApiError(err) && err.status === 502) {
        setSubmitError(t.t('paymentUnavailable'));
      } else if (isApiError(err) && err.isNetwork) {
        setSubmitError(t.t('errorNetwork'));
      } else if (isApiError(err) && err.isNotFound) {
        setSubmitError(t.t('productNotFound'));
      } else {
        setSubmitError(t.t('errorGeneric'));
      }
      setAttempt((n) => n + 1);
    }
  }

  const total = totalMinor(product.prices, quantities);
  const noDepartures = slots.data !== null && !upcoming.some((s) => s.available > 0);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-8">
      <section aria-labelledby="when-title" className="flex flex-col gap-3">
        <h2 id="when-title" className="text-xl font-bold">
          1. {t.t('stepWhen')}
        </h2>
        {slots.loading && !slots.data ? <LoadingBlock label={t.t('loading')} /> : null}
        {slots.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={slots.reload}>
                {t.t('retry')}
              </Button>
            }
          >
            {isApiError(slots.error) && slots.error.isNetwork
              ? t.t('errorNetwork')
              : t.t('errorGeneric')}
          </Alert>
        ) : null}
        {noDepartures ? (
          <p className="rounded-2xl bg-surface-2 p-4 text-muted">{t.t('noDepartures')}</p>
        ) : null}
        {slots.data && !noDepartures ? (
          <SlotPicker
            days={days}
            slots={upcoming}
            timezone={timezone}
            t={t}
            date={date}
            onDateChange={(day) => {
              setDate(day);
              setSlotId(null);
            }}
            slotId={slotId}
            onSlotChange={chooseSlot}
            error={slotError}
          />
        ) : null}
        {slotError && !date ? (
          <p role="alert" className="font-medium text-danger-fg">
            {slotError}
          </p>
        ) : null}
      </section>

      {slot ? (
        <section aria-labelledby="tickets-title" className="flex flex-col gap-3">
          <h2 id="tickets-title" className="text-xl font-bold">
            2. {t.t('stepTickets')}
          </h2>
          <TicketQuantities
            prices={product.prices}
            currency={product.currency}
            quantities={quantities}
            onChange={(next) => {
              setQuantities(next);
              setTicketError(null);
            }}
            available={slot.available}
            t={t}
            error={ticketError}
          />
        </section>
      ) : null}

      <section aria-labelledby="details-title" className="flex flex-col gap-4">
        <h2 id="details-title" className="text-xl font-bold">
          {slot ? 3 : 2}. {t.t('yourDetails')}
        </h2>
        <Field
          label={t.t('name')}
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <p id="contact-hint" className="text-muted">
          {t.t('contactHint')}
        </p>
        <Field
          label={t.t('email')}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email ?? (errors.contact && !phone.trim() ? errors.contact : undefined)}
        />
        <Field
          label={t.t('phone')}
          hint={t.t('phoneHint')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
        />
      </section>

      {submitError ? <Alert tone="error">{submitError}</Alert> : null}

      <StickyActions>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{t.t('total')}</p>
            <MoneyText
              amountMinor={total}
              currency={product.currency}
              lang={lang}
              className="text-xl font-extrabold"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            loading={busy}
            loadingText={t.t('redirecting')}
            className="min-w-0 flex-1 sm:flex-none"
          >
            {total > 0
              ? t.t('payNow', { amount: formatMoney(total, product.currency, lang) })
              : t.t('continue')}
          </Button>
        </div>
        <p className="mt-2 text-center text-sm text-muted">{t.t('securePayment')}</p>
      </StickyActions>
    </form>
  );
}
