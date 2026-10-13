'use client';

import type { OperatorAnalyticsDto } from '@ap/contracts';
import { useT } from '@/components/I18nProvider';
import { MoneyText } from '@/components/MoneyText';
import { share } from '@/lib/analytics';
import { bookingChannel } from '@/lib/labels';

type Channel = OperatorAnalyticsDto['channels'][number];

/**
 * Revenue per booking channel as horizontal bars in one hue: the label names each bar, so colour
 * carries nothing. Promo codes only appear once someone has used one.
 */
export function ChannelBars({ channels, currency }: { channels: Channel[]; currency: string }) {
  const i18n = useT();
  const { t, lang } = i18n;
  const rows = channels.filter((c) => c.channel !== 'promo_code' || c.bookings > 0);
  const total = rows.reduce((sum, c) => sum + c.revenueMinor, 0);
  const max = Math.max(1, ...rows.map((c) => c.revenueMinor));
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((c) => (
        <li key={c.channel}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{bookingChannel(i18n, c.channel)}</span>
            <MoneyText
              amountMinor={c.revenueMinor}
              currency={currency}
              lang={lang}
              className="font-semibold"
            />
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
            {t('charts.channelLine', { count: c.bookings, share: share(c.revenueMinor, total) })}
          </p>
        </li>
      ))}
    </ul>
  );
}
