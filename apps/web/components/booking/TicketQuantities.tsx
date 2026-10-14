'use client';

import type { PriceDto } from '@ap/contracts';
import type { ReactNode } from 'react';
import { maxQuantityFor, seatsNeeded, totalMinor, type Quantities } from '@/lib/booking';
import { formatMoney } from '@/lib/format';
import type { Translator } from '@/lib/i18n';
import { useT } from '../I18nProvider';
import { MoneyText } from '../MoneyText';
import { Stepper } from '../Stepper';

interface TicketQuantitiesProps {
  prices: PriceDto[];
  currency: string;
  quantities: Quantities;
  onChange: (quantities: Quantities) => void;
  available: number;
  /** Defaults to the page language from the provider. */
  t?: Translator;
  error?: string | null;
  /** A discount code applied to the booking, and how much it takes off. */
  discount?: { code: string; minor: number } | null;
  /** Shown above the total (the discount code field). */
  children?: ReactNode;
}

/** One stepper per ticket type and extra, the seats check and the running total. */
export function TicketQuantities({
  prices,
  currency,
  quantities,
  onChange,
  available,
  t: given,
  error,
  discount,
  children,
}: TicketQuantitiesProps) {
  const current = useT();
  const t = given ?? current;
  const seats = seatsNeeded(prices, quantities);
  const subtotal = totalMinor(prices, quantities);
  const tooMany = seats > available;
  const tickets = prices.filter((p) => p.kind !== 'extra');
  const extras = prices.filter((p) => p.kind === 'extra');
  const discounted = discount && discount.minor > 0 ? discount : null;

  const stepper = (price: PriceDto) => (
    <Stepper
      key={price.id}
      label={price.label}
      description={formatMoney(price.amountMinor, currency, t.lang)}
      value={quantities[price.id] ?? 0}
      min={0}
      max={maxQuantityFor(price, prices, quantities, available)}
      onChange={(value) => onChange({ ...quantities, [price.id]: value })}
      decreaseLabel={t.t(price.kind === 'extra' ? 'public.removeExtra' : 'public.remove', {
        label: price.label,
      })}
      increaseLabel={t.t(price.kind === 'extra' ? 'public.addExtra' : 'public.add', {
        label: price.label,
      })}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="min-w-0">
        <legend className="mb-1 text-lg font-semibold">{t.t('public.tickets')}</legend>
        <div className="divide-y divide-line">{tickets.map(stepper)}</div>
      </fieldset>

      {tooMany ? (
        <p role="alert" className="font-medium text-danger-fg">
          {t.tp('public.notEnoughSeats', available)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-medium text-danger-fg">
          {error}
        </p>
      ) : null}

      {extras.length > 0 ? (
        <fieldset className="min-w-0">
          <legend className="text-lg font-semibold">{t.t('public.extras')}</legend>
          <p className="text-sm text-muted">{t.t('public.extrasHint')}</p>
          <div className="divide-y divide-line">{extras.map(stepper)}</div>
        </fieldset>
      ) : null}

      {children}

      <div className="flex flex-col gap-1 rounded-2xl bg-surface-2 px-4 py-3" aria-live="polite">
        {discounted ? (
          <>
            <p className="flex items-baseline justify-between gap-3 text-muted">
              <span>{t.t('public.subtotal')}</span>
              <MoneyText amountMinor={subtotal} currency={currency} lang={t.lang} />
            </p>
            <p className="flex items-baseline justify-between gap-3 font-medium text-success-fg">
              <span>{t.t('public.discountLine', { code: discounted.code })}</span>
              <span>−{formatMoney(discounted.minor, currency, t.lang)}</span>
            </p>
          </>
        ) : null}
        <p className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{t.t('public.total')}</span>
          <MoneyText
            amountMinor={subtotal - (discounted?.minor ?? 0)}
            currency={currency}
            lang={t.lang}
            className="text-2xl font-extrabold"
          />
        </p>
      </div>
    </div>
  );
}
