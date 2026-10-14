'use client';

import {
  localeSchema,
  type CheckoutResultDto,
  type DiscountPreviewDto,
  type Locale,
  type ProductDto,
  type SlotDto,
} from '@ap/contracts';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { BookingQuestions } from '@/components/booking/BookingQuestions';
import { DiscountCodeField } from '@/components/booking/DiscountCodeField';
import { ChoiceGroup, Field } from '@/components/Field';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { SlotPicker } from '@/components/booking/SlotPicker';
import { TicketQuantities } from '@/components/booking/TicketQuantities';
import { LoadingBlock } from '@/components/Spinner';
import { StickyActions } from '@/components/StickyActions';
import { isApiError } from '@/lib/api';
import {
  bookingTotals,
  chosenItems,
  defaultQuantities,
  groupSlotsByDay,
  seatsNeeded,
  ticketCount,
  toItems,
  upcomingSlots,
  type Quantities,
} from '@/lib/booking';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '@/lib/contact';
import { DEFAULT_TIMEZONE, dateKeyInTz, formatDayLong, formatTime, nextDays } from '@/lib/dates';
import { discountErrorKey, discountText } from '@/lib/discounts';
import { affiliateApi } from '@/lib/endpoints';
import { formatBps, formatMoney } from '@/lib/format';
import { formatDuration } from '@/lib/i18n';
import { type AnswerValues, missingAnswers, toAnswers } from '@/lib/questions';
import { useAffiliateHome } from '@/lib/useAffiliateHome';
import { errorMessage, useApi } from '@/lib/useApi';
import { BookingResult } from './BookingResult';

const TZ = DEFAULT_TIMEZONE;
const STEP_KEYS = [
  'affiliate.book.stepTrip',
  'affiliate.book.stepTickets',
  'affiliate.book.stepCustomer',
] as const;

/** A language's own name ("Deutsch", "Română"), so the customer recognises it. */
function nativeLanguageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code.toUpperCase();
  }
}
type Step = 1 | 2 | 3;
type Payment = 'link' | 'on_site';

interface CustomerErrors {
  name?: string;
  contact?: string;
  phone?: string;
  email?: string;
}

export function BookFlow() {
  const i18n = useT();
  const { t, tp, lang } = i18n;
  const searchParams = useSearchParams();
  const urlStep = Math.min(3, Math.max(1, Number(searchParams.get('step')) || 1)) as Step;
  const home = useAffiliateHome();
  const allowPayOnSite = home.data?.tenant.allowPayOnSite ?? false;

  const products = useApi('affiliate-products', (signal) => affiliateApi.products({ signal }));
  const [productId, setProductId] = useState<string | null>(null);
  const product: ProductDto | null = products.data?.find((p) => p.id === productId) ?? null;

  const days = useMemo(() => nextDays(14, TZ), []);
  const slots = useApi(product ? `affiliate-slots:${product.id}` : null, (signal) =>
    affiliateApi.slots(product!.id, { from: days[0], to: days[days.length - 1] }, { signal }),
  );
  const upcoming = useMemo(() => upcomingSlots(slots.data ?? []), [slots.data]);

  const [date, setDate] = useState<string | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const slot: SlotDto | null = upcoming.find((s) => s.id === slotId) ?? null;
  const [quantities, setQuantities] = useState<Quantities>({});
  const [discount, setDiscount] = useState<DiscountPreviewDto | null>(null);
  // The affiliate's own codes (a hotel's -10% for its guests), offered with one tap.
  const ownCodes = useApi('affiliate-discount-codes', (signal) =>
    affiliateApi.discountCodes({ signal }),
  );
  const suggestions = (ownCodes.data ?? []).filter(
    (c) => c.productIds.length === 0 || (product && c.productIds.includes(product.id)),
  );

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [room, setRoom] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const [payment, setPayment] = useState<Payment>('link');
  const [answers, setAnswers] = useState<AnswerValues>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});

  const [stepError, setStepError] = useState<string | null>(null);
  const [customerErrors, setCustomerErrors] = useState<CustomerErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckoutResultDto | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // One product: select it straight away.
  useEffect(() => {
    if (!productId && products.data?.length === 1) setProductId(products.data[0]!.id);
  }, [products.data, productId]);

  // When departures load, preselect the first day that still has seats.
  useEffect(() => {
    if (!slots.data) return;
    const byDay = groupSlotsByDay(upcoming, TZ);
    const first = days.find((d) => (byDay.get(d) ?? []).some((s) => s.available > 0));
    setDate((current) => current ?? first ?? days[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots.data]);

  // The step in the URL (so the phone's back gesture goes to the previous step), guarded by
  // what has actually been filled in.
  const step: Step =
    urlStep >= 3 && slot && product && ticketCount(quantities, product.prices) > 0
      ? 3
      : urlStep >= 2 && slot
        ? 2
        : 1;

  useEffect(() => {
    if (!result && urlStep !== step)
      window.history.replaceState(null, '', step === 1 ? '/a/book' : `/a/book?step=${step}`);
  }, [urlStep, step, result]);

  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      headingRef.current?.focus();
      previousStep.current = step;
    }
  }, [step]);

  function goTo(next: Step) {
    setStepError(null);
    window.history.pushState(null, '', next === 1 ? '/a/book' : `/a/book?step=${next}`);
    window.scrollTo({ top: 0 });
  }

  function continueFromStep1() {
    if (!product) return setStepError(t('affiliate.book.chooseProduct'));
    if (!slot) return setStepError(t('affiliate.book.chooseTime'));
    if (ticketCount(quantities, product.prices) === 0)
      setQuantities(defaultQuantities(product.prices, slot.available));
    goTo(2);
  }

  function continueFromStep2() {
    if (!product || !slot) return;
    if (ticketCount(quantities, product.prices) === 0)
      return setStepError(t('affiliate.book.selectTickets'));
    if (seatsNeeded(product.prices, quantities) > slot.available)
      return setStepError(tp('affiliate.book.notEnoughSeats', slot.available));
    goTo(3);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !slot) return;
    const errors: CustomerErrors = {};
    const cleanPhone = phone.trim() ? normalizePhone(phone) : '';
    const cleanEmail = email.trim() ? normalizeEmail(email) : '';
    if (!name.trim()) errors.name = t('affiliate.book.nameRequired');
    if (cleanPhone && !isValidPhone(cleanPhone)) errors.phone = t('affiliate.book.phoneInvalid');
    if (cleanEmail && !isValidEmail(cleanEmail)) errors.email = t('affiliate.book.emailInvalid');
    if (!cleanPhone && !cleanEmail) errors.contact = t('affiliate.book.contactRequired');
    const unanswered = Object.fromEntries(
      missingAnswers(product.questions, answers).map((id) => [id, t('public.questions.required')]),
    );
    setCustomerErrors(errors);
    setAnswerErrors(unanswered);
    if (Object.keys(errors).length > 0 || Object.keys(unanswered).length > 0) return;

    setBusy(true);
    setSubmitError(null);
    try {
      const created = await affiliateApi.createBooking({
        slotId: slot.id,
        items: toItems(quantities),
        customer: {
          name: name.trim(),
          phone: cleanPhone || undefined,
          email: cleanEmail || undefined,
          locale,
          hotelRoom: room.trim() || undefined,
        },
        answers: toAnswers(product.questions, answers),
        payment: allowPayOnSite ? payment : 'link',
        discountCode: discount?.code,
      });
      setResult(created);
      window.history.replaceState(null, '', '/a/book?step=3');
      window.scrollTo({ top: 0 });
      home.reload();
    } catch (err) {
      const codeProblem = discountErrorKey(err);
      if (codeProblem) {
        setDiscount(null);
        setSubmitError(t(codeProblem));
      } else if (isApiError(err) && err.status === 409) {
        setSubmitError(t('affiliate.book.errorSoldOut'));
        slots.reload();
      } else if (isApiError(err) && err.status === 403) {
        setSubmitError(t('affiliate.book.errorInactive'));
      } else if (isApiError(err) && err.status === 422 && payment === 'on_site') {
        setSubmitError(t('affiliate.book.errorNoPayOnSite'));
      } else if (isApiError(err) && err.status === 502) {
        setSubmitError(t('affiliate.book.errorPayments'));
      } else {
        setSubmitError(errorMessage(err, i18n));
      }
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setResult(null);
    setSlotId(null);
    setQuantities({});
    setDiscount(null);
    setName('');
    setPhone('');
    setEmail('');
    setRoom('');
    setAnswers({});
    setAnswerErrors({});
    setLocale('en');
    setPayment('link');
    setCustomerErrors({});
    setSubmitError(null);
    slots.reload();
    window.history.replaceState(null, '', '/a/book');
    window.scrollTo({ top: 0 });
  }

  if (result && product) {
    return (
      <div className="page-x mx-auto max-w-xl">
        <BookingResult
          result={result}
          productName={product.name}
          customerPhone={normalizePhone(phone) || null}
          customerName={name.trim()}
          locale={locale}
          onNewBooking={startOver}
        />
      </div>
    );
  }

  const currency = product?.currency ?? home.data?.tenant.currency ?? 'RON';
  const { discountMinor, totalMinor: total } = product
    ? bookingTotals(product.prices, quantities, discount)
    : { discountMinor: 0, totalMinor: 0 };

  return (
    <div className="page-x mx-auto flex max-w-xl flex-col gap-4">
      <header className="pt-4">
        <p className="font-semibold text-muted">{t('affiliate.book.header', { step, total: 3 })}</p>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          {t(STEP_KEYS[step - 1]!)}
        </h1>
        <ol className="mt-3 grid grid-cols-3 gap-1.5" aria-label={t('affiliate.book.steps')}>
          {STEP_KEYS.map((key, i) => (
            <li
              key={key}
              aria-current={i + 1 === step ? 'step' : undefined}
              className={`h-1.5 rounded-full ${i + 1 <= step ? 'bg-brand' : 'bg-surface-2'}`}
            >
              <span className="visually-hidden">
                {i + 1 < step ? t('affiliate.book.stepDone', { step: t(key) }) : t(key)}
              </span>
            </li>
          ))}
        </ol>
      </header>

      {step === 1 ? (
        <>
          {products.loading && !products.data ? <LoadingBlock /> : null}
          {products.error ? (
            <Alert
              tone="error"
              action={
                <Button variant="secondary" onClick={products.reload}>
                  {t('common.retry')}
                </Button>
              }
            >
              {errorMessage(products.error, i18n)}
            </Alert>
          ) : null}
          {products.data && products.data.length === 0 ? (
            <Alert tone="info">{t('affiliate.book.noProducts')}</Alert>
          ) : null}

          {products.data && products.data.length > 1 ? (
            <ChoiceGroup
              legend={t('affiliate.book.productLegend')}
              name="product"
              value={productId}
              onChange={(id) => {
                setProductId(id);
                setDate(null);
                setSlotId(null);
                setQuantities({});
                setDiscount(null);
                setAnswers({});
                setAnswerErrors({});
                setStepError(null);
              }}
              options={products.data.map((p) => ({
                value: p.id,
                label: p.name,
                description: (
                  <>
                    {t('affiliate.book.productLine', {
                      duration: formatDuration(p.durationMinutes, lang),
                      price: formatMoney(p.fromMinor, p.currency, lang),
                    })}
                    {p.commissionRateBps !== null ? (
                      <span className="block font-semibold">
                        {t('affiliate.book.tripCommission', {
                          rate: formatBps(p.commissionRateBps, lang),
                        })}
                      </span>
                    ) : null}
                  </>
                ),
              }))}
            />
          ) : null}

          {product && products.data?.length === 1 ? (
            <p className="rounded-2xl bg-surface-2 p-4">
              <span className="block font-semibold">{product.name}</span>
              <span className="text-sm text-muted">
                {t('affiliate.book.productLine', {
                  duration: formatDuration(product.durationMinutes, lang),
                  price: formatMoney(product.fromMinor, product.currency, lang),
                })}
              </span>
              {product.commissionRateBps !== null ? (
                <span className="block text-sm font-semibold">
                  {t('affiliate.book.tripCommission', {
                    rate: formatBps(product.commissionRateBps, lang),
                  })}
                </span>
              ) : null}
            </p>
          ) : null}

          {product ? (
            slots.loading && !slots.data ? (
              <LoadingBlock label={t('affiliate.book.loadingSlots')} />
            ) : slots.error ? (
              <Alert
                tone="error"
                action={
                  <Button variant="secondary" onClick={slots.reload}>
                    {t('common.retry')}
                  </Button>
                }
              >
                {errorMessage(slots.error, i18n)}
              </Alert>
            ) : upcoming.length === 0 ? (
              <Alert tone="info">{t('affiliate.book.noDepartures')}</Alert>
            ) : (
              <SlotPicker
                days={days}
                slots={upcoming}
                timezone={TZ}
                t={i18n}
                date={date}
                onDateChange={(d) => {
                  setDate(d);
                  setSlotId(null);
                  setStepError(null);
                }}
                slotId={slotId}
                onSlotChange={(s) => {
                  setSlotId(s.id);
                  setStepError(null);
                }}
                error={stepError}
              />
            )
          ) : stepError ? (
            <p role="alert" className="font-medium text-danger-fg">
              {stepError}
            </p>
          ) : null}

          <StickyActions aboveNav>
            <Button size="lg" block onClick={continueFromStep1}>
              {t('affiliate.book.continue')}
            </Button>
          </StickyActions>
        </>
      ) : null}

      {step === 2 && product && slot ? (
        <>
          <SlotSummary product={product} slot={slot} onChange={() => goTo(1)} />
          <Card>
            <TicketQuantities
              prices={product.prices}
              currency={currency}
              quantities={quantities}
              onChange={(q) => {
                setQuantities(q);
                setStepError(null);
              }}
              available={slot.available}
              t={i18n}
              error={stepError}
              discount={discount ? { code: discount.code, minor: discountMinor } : null}
            >
              {home.data ? (
                <DiscountCodeField
                  tenantSlug={home.data.tenant.slug}
                  productId={product.id}
                  currency={currency}
                  applied={discount}
                  onApplied={setDiscount}
                  suggestions={suggestions}
                  t={i18n}
                />
              ) : null}
            </TicketQuantities>
          </Card>
          <StickyActions aboveNav>
            <Button size="lg" block onClick={continueFromStep2}>
              {t('affiliate.book.continueTotal', { total: formatMoney(total, currency, lang) })}
            </Button>
          </StickyActions>
        </>
      ) : null}

      {step === 3 && product && slot ? (
        <form onSubmit={submit} method="post" noValidate className="flex flex-col gap-4">
          <SlotSummary
            product={product}
            slot={slot}
            onChange={() => goTo(1)}
            extra={
              <span className="flex items-center justify-between gap-2">
                <span>
                  {chosenItems(product.prices, quantities)}
                  {discount && discountMinor > 0 ? (
                    <span className="block text-sm font-medium text-success-fg">
                      {t('public.discount.applied', {
                        code: discount.code,
                        discount: discountText(discount, currency, lang),
                      })}
                    </span>
                  ) : null}
                </span>
                <MoneyText
                  amountMinor={total}
                  currency={currency}
                  lang={lang}
                  className="font-bold"
                />
              </span>
            }
          />

          <Card>
            <div className="flex flex-col gap-4">
              <Field
                label={t('affiliate.book.nameLabel')}
                name="customer-name"
                // The customer's data, not the receptionist's: do not autofill her own details.
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={customerErrors.name}
              />
              <p
                className={`text-sm ${customerErrors.contact ? 'font-medium text-danger-fg' : 'text-muted'}`}
                role={customerErrors.contact ? 'alert' : undefined}
              >
                {customerErrors.contact ?? t('affiliate.book.contactHint')}
              </p>
              <Field
                label={t('affiliate.book.phoneLabel')}
                hint={t('affiliate.book.phoneHint')}
                name="customer-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                enterKeyHint="next"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={customerErrors.phone}
                optionalText={t('affiliate.book.orEmail')}
              />
              <Field
                label={t('affiliate.book.emailLabel')}
                name="customer-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={customerErrors.email}
                optionalText={t('affiliate.book.orPhone')}
              />
              <Field
                label={t('affiliate.book.roomLabel')}
                name="hotel-room"
                autoComplete="off"
                enterKeyHint="done"
                maxLength={20}
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                optionalText={t('affiliate.optional')}
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
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-5">
              <ChoiceGroup<Locale>
                legend={t('affiliate.book.localeLegend')}
                hint={t('affiliate.book.localeHint')}
                name="locale"
                value={locale}
                onChange={setLocale}
                gridClassName="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3"
                options={localeSchema.options.map((code) => ({
                  value: code,
                  label: nativeLanguageName(code),
                }))}
              />
              {allowPayOnSite ? (
                <ChoiceGroup<Payment>
                  legend={t('affiliate.book.paymentLegend')}
                  name="payment"
                  value={payment}
                  onChange={setPayment}
                  options={[
                    {
                      value: 'link',
                      label: t('affiliate.book.payOnline'),
                      description: t('affiliate.book.payOnlineHint'),
                    },
                    {
                      value: 'on_site',
                      label: t('affiliate.book.payOnSite'),
                      description: t('affiliate.book.payOnSiteHint'),
                    },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">{t('affiliate.book.payOnlineOnly')}</p>
              )}
            </div>
          </Card>

          {submitError ? <Alert tone="error">{submitError}</Alert> : null}

          <StickyActions aboveNav>
            <Button
              type="submit"
              size="lg"
              block
              loading={busy}
              loadingText={t('affiliate.book.booking')}
            >
              {t('affiliate.book.submit', { total: formatMoney(total, currency, lang) })}
            </Button>
          </StickyActions>
        </form>
      ) : null}
    </div>
  );
}

function SlotSummary({
  product,
  slot,
  onChange,
  extra,
}: {
  product: ProductDto;
  slot: SlotDto;
  onChange: () => void;
  extra?: ReactNode;
}) {
  const { t, lang } = useT();
  const dayKey = dateKeyInTz(slot.startsAt, TZ);
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{product.name}</p>
          <p className="text-muted">
            {t('affiliate.book.slotWhen', {
              day: formatDayLong(dayKey, lang),
              time: formatTime(slot.startsAt, TZ, lang),
            })}
          </p>
        </div>
        <Button variant="ghost" onClick={onChange} className="-mr-2 -mt-2 shrink-0 px-3">
          {t('affiliate.book.change')}
        </Button>
      </div>
      {extra}
    </div>
  );
}
