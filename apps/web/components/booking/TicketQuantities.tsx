'use client';

import type { PriceDto } from '@ap/contracts';
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
}

/** One stepper per price type, the seats check and the running total. */
export function TicketQuantities({
  prices,
  currency,
  quantities,
  onChange,
  available,
  t: given,
  error,
}: TicketQuantitiesProps) {
  const current = useT();
  const t = given ?? current;
  const seats = seatsNeeded(prices, quantities);
  const total = totalMinor(prices, quantities);
  const tooMany = seats > available;

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="min-w-0">
        <legend className="mb-1 text-lg font-semibold">{t.t('public.tickets')}</legend>
        <div className="divide-y divide-line">
          {prices.map((price) => (
            <Stepper
              key={price.id}
              label={price.label}
              description={formatMoney(price.amountMinor, currency, t.lang)}
              value={quantities[price.id] ?? 0}
              min={0}
              max={maxQuantityFor(price, prices, quantities, available)}
              onChange={(value) => onChange({ ...quantities, [price.id]: value })}
              decreaseLabel={t.t('public.remove', { label: price.label })}
              increaseLabel={t.t('public.add', { label: price.label })}
            />
          ))}
        </div>
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

      <div
        className="flex items-baseline justify-between rounded-2xl bg-surface-2 px-4 py-3"
        aria-live="polite"
      >
        <span className="font-semibold">{t.t('public.total')}</span>
        <MoneyText
          amountMinor={total}
          currency={currency}
          lang={t.lang}
          className="text-2xl font-extrabold"
        />
      </div>
    </div>
  );
}
