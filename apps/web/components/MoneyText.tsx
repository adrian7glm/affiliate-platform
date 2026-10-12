import { formatMoney } from '@/lib/format';

interface MoneyTextProps {
  amountMinor: number;
  currency: string;
  lang?: string;
  className?: string;
}

/** Money from integer minor units, formatted for the UI language. */
export function MoneyText({ amountMinor, currency, lang = 'ro', className = '' }: MoneyTextProps) {
  return (
    <span className={`whitespace-nowrap tabular-nums ${className}`}>
      {formatMoney(amountMinor, currency, lang)}
    </span>
  );
}
