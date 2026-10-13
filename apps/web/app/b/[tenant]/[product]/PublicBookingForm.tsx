'use client';

import {
  localeSchema,
  type ProductDto,
  type PublicCheckoutBody,
  type SlotDto,
} from '@ap/contracts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/Alert';
import { BookingQuestions } from '@/components/booking/BookingQuestions';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { SlotPicker } from '@/components/booking/SlotPicker';
import { TicketQuantities } from '@/components/booking/TicketQuantities';
import { CancellationPolicy } from '@/components/public/CancellationPolicy';
import { Rich, slots as richSlots } from '@/components/Rich';
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
import type { Lang } from '@/lib/i18n';
import {
  parseTicketUrl,
  readCookie,
  REF_COOKIE,
  SOURCE_COOKIE,
  ticketPath,
  VISITOR_COOKIE,
} from '@/lib/links';
import { type AnswerValues, missingAnswers, toAnswers } from '@/lib/questions';
import { useApi } from '@/lib/useApi';

const REF_RE = /^[A-Za-z0-9_-]{1,32}$/;

interface DetailErrors {
  name?: string;
  contact?: string;
  email?: string;
  phone?: string;
  terms?: string;
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
  tenantName,
  cancellationPolicy,
  product,
  timezone,
}: {
  tenantSlug: string;
  tenantName: string;
  cancellationPolicy: string | null;
  product: ProductDto;
  timezone: string;
}) {
  const t = useT();
  const { lang } = t;
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
  const [accepted, setAccepted] = useState(false);
  const [answers, setAnswers] = useState<AnswerValues>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});

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
    if (!name.trim()) nextErrors.name = t.t('public.errorName');
    if (cleanEmail && !isValidEmail(cleanEmail)) nextErrors.email = t.t('public.errorEmail');
    if (cleanPhone && !isValidPhone(cleanPhone)) nextErrors.phone = t.t('public.errorPhone');
    if (!cleanEmail && !cleanPhone) nextErrors.contact = t.t('public.errorContact');
    if (!accepted) nextErrors.terms = t.t('public.errorTerms');
    const unanswered = Object.fromEntries(
      missingAnswers(product.questions, answers).map((id) => [
        id,
        t.t('public.questions.required'),
      ]),
    );

    const missingSlot = !slot ? t.t('public.chooseTimeFirst') : null;
    const ticketProblem = !slot
      ? null
      : ticketCount(quantities) === 0
        ? t.t('public.selectTickets')
        : seatsNeeded(product.prices, quantities) > slot.available
          ? t.tp('public.notEnoughSeats', slot.available)
          : null;

    setSlotError(missingSlot);
    setTicketError(ticketProblem);
    setErrors(nextErrors);
    setAnswerErrors(unanswered);
    if (
      missingSlot ||
      ticketProblem ||
      Object.keys(nextErrors).length > 0 ||
      Object.keys(unanswered).length > 0
    ) {
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
          // Emails and texts go out in this language; one the API does not know gets English.
          locale: localeSchema.catch('en').parse(lang),
        },
        answers: toAnswers(product.questions, answers),
        acceptTerms: true,
        ...attribution(),
      });
      window.location.assign(nextLocation(result.paymentUrl, result.ticketUrl, lang));
      // Keep the button busy while the browser navigates away.
    } catch (err) {
      setBusy(false);
      if (isApiError(err) && err.status === 409) {
        setSubmitError(t.t('public.slotGone'));
        setSlotId(null);
        slots.reload();
      } else if (isApiError(err) && err.status === 502) {
        setSubmitError(t.t('public.paymentUnavailable'));
      } else if (isApiError(err) && err.isNetwork) {
        setSubmitError(t.t('common.errorNetwork'));
      } else if (isApiError(err) && err.isNotFound) {
        setSubmitError(t.t('public.productNotFound'));
      } else {
        setSubmitError(t.t('common.errorGeneric'));
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
          {t.t('public.numbered', { number: 1, title: t.t('public.stepWhen') })}
        </h2>
        {slots.loading && !slots.data ? <LoadingBlock label={t.t('common.loading')} /> : null}
        {slots.error ? (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" onClick={slots.reload}>
                {t.t('common.retry')}
              </Button>
            }
          >
            {isApiError(slots.error) && slots.error.isNetwork
              ? t.t('common.errorNetwork')
              : t.t('common.errorGeneric')}
          </Alert>
        ) : null}
        {noDepartures ? (
          <p className="rounded-2xl bg-surface-2 p-4 text-muted">{t.t('public.noDepartures')}</p>
        ) : null}
        {slots.data && !noDepartures ? (
          <SlotPicker
            days={days}
            slots={upcoming}
            timezone={timezone}
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
            {t.t('public.numbered', { number: 2, title: t.t('public.stepTickets') })}
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
            error={ticketError}
          />
        </section>
      ) : null}

      <section aria-labelledby="details-title" className="flex flex-col gap-4">
        <h2 id="details-title" className="text-xl font-bold">
          {t.t('public.numbered', { number: slot ? 3 : 2, title: t.t('public.yourDetails') })}
        </h2>
        <Field
          label={t.t('public.name')}
          name="name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <p id="contact-hint" className="text-muted">
          {t.t('public.contactHint')}
        </p>
        <Field
          label={t.t('public.email')}
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
          label={t.t('public.phone')}
          hint={t.t('public.phoneHint')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errors.phone}
        />
        <BookingQuestions
          questions={product.questions}
          values={answers}
          onChange={(id, value) => {
            setAnswers((prev) => ({ ...prev, [id]: value }));
            setAnswerErrors(({ [id]: _cleared, ...rest }) => rest);
          }}
          errors={answerErrors}
        />
      </section>

      <section
        aria-label={t.t('public.policy.title')}
        className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4"
      >
        <CancellationPolicy tenantName={tenantName} policy={cancellationPolicy} titleAs="h3" />
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="acceptTerms"
              className="mt-0.5 size-6 shrink-0"
              checked={accepted}
              onChange={(e) => {
                setAccepted(e.target.checked);
                if (e.target.checked) setErrors((prev) => ({ ...prev, terms: undefined }));
              }}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={errors.terms ? 'terms-error' : undefined}
            />
            <span>
              <Rich
                text={t.t('public.acceptTerms', richSlots('terms', 'privacy'))}
                parts={{
                  terms: (
                    <a
                      href={`/legal/terms?lang=${lang}`}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-brand-strong underline"
                    >
                      {t.t('public.termsLink')}
                    </a>
                  ),
                  privacy: (
                    <a
                      href={`/legal/privacy?lang=${lang}`}
                      target="_blank"
                      rel="noopener"
                      className="font-semibold text-brand-strong underline"
                    >
                      {t.t('public.privacyLink')}
                    </a>
                  ),
                }}
              />
            </span>
          </label>
          {errors.terms ? (
            <p id="terms-error" role="alert" className="text-sm font-medium text-danger-fg">
              {errors.terms}
            </p>
          ) : null}
        </div>
      </section>

      {submitError ? <Alert tone="error">{submitError}</Alert> : null}

      <StickyActions>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{t.t('public.total')}</p>
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
            loadingText={t.t('public.redirecting')}
            className="min-w-0 flex-1 sm:flex-none"
          >
            {total > 0
              ? t.t('public.payNow', { amount: formatMoney(total, product.currency, lang) })
              : t.t('public.continue')}
          </Button>
        </div>
        <p className="mt-2 text-center text-sm text-muted">{t.t('public.securePayment')}</p>
      </StickyActions>
    </form>
  );
}
