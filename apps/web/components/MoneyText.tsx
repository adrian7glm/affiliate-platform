'use client';

import { formatMoney } from '@/lib/format';
import { useT } from './I18nProvider';

interface MoneyTextProps {
  amountMinor: number;
  currency: string;
  /** Defaults to the page language. */
  lang?: string;
  className?: string;
}

/** Money from integer minor units, formatted for the UI language. */
export function MoneyText({ amountMinor, currency, lang, className = '' }: MoneyTextProps) {
  const current = useT().lang;
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {formatMoney(amountMinor, currency, lang ?? current)}
    </span>
  );
}
