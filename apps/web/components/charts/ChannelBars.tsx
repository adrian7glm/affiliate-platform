import type { OperatorAnalyticsDto } from '@ap/contracts';
import { MoneyText } from '@/components/MoneyText';
import { share } from '@/lib/analytics';
import { pluralRo } from '@/lib/i18n';
import { BOOKING_CHANNEL } from '@/lib/labels';

type Channel = OperatorAnalyticsDto['channels'][number];

/**
 * Revenue per booking channel as horizontal bars in one hue: the label names each bar, so colour
 * carries nothing. Promo codes only appear once someone has used one.
 */
export function ChannelBars({ channels, currency }: { channels: Channel[]; currency: string }) {
  const rows = channels.filter((c) => c.channel !== 'promo_code' || c.bookings > 0);
  const total = rows.reduce((sum, c) => sum + c.revenueMinor, 0);
  const max = Math.max(1, ...rows.map((c) => c.revenueMinor));
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((c) => (
        <li key={c.channel}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{BOOKING_CHANNEL[c.channel]}</span>
            <MoneyText amountMinor={c.revenueMinor} currency={currency} className="font-semibold" />
          </div>
          <div className="mt-1.5 h-3 rounded-full bg-surface-2" aria-hidden="true">
            {c.revenueMinor > 0 ? (
              <div
                className="h-full min-w-1 rounded-full bg-viz-1"
                style={{ width: `${(c.revenueMinor / max) * 100}%` }}
              />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {pluralRo(c.bookings, 'rezervare', 'rezervări')} · {share(c.revenueMinor, total)}% din
            încasări
          </p>
        </li>
      ))}
    </ul>
  );
}
