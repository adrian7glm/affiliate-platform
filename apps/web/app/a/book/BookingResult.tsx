'use client';

import type { CheckoutResultDto, Locale } from '@ap/contracts';
import { useEffect, useRef } from 'react';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { useT } from '@/components/I18nProvider';
import { IconChat, IconCheck, IconExternal, IconMessage, IconPlus } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { DEFAULT_TIMEZONE, dateKeyInTz, formatDayLong, formatTime } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { getT, isLang, type Lang } from '@/lib/i18n';
import { parseTicketUrl, ticketPath } from '@/lib/links';
import { smsUrl, whatsappUrl } from '@/lib/share';

interface BookingResultProps {
  result: CheckoutResultDto;
  productName: string;
  customerName: string;
  customerPhone: string | null;
  locale: Locale;
  onNewBooking: () => void;
}

/** The customer's language when the platform has texts for it, else English. */
export function customerLang(locale: Locale): Lang {
  return isLang(locale) ? locale : 'en';
}

/** Message for the customer, in their language when we have it (else English). */
export function customerMessage(
  kind: 'pay' | 'ticket',
  locale: Locale,
  data: { name: string; product: string; startsAt: string; url: string },
): string {
  const lang = customerLang(locale);
  const { t } = getT(lang);
  const vars = {
    name: data.name.split(' ')[0] ?? data.name,
    product: data.product,
    day: formatDayLong(dateKeyInTz(data.startsAt, DEFAULT_TIMEZONE), lang),
    time: formatTime(data.startsAt, DEFAULT_TIMEZONE, lang),
    url: data.url,
  };
  return kind === 'pay'
    ? t('affiliate.customerMessage.pay', vars)
    : t('affiliate.customerMessage.ticket', vars);
}

export function BookingResult({
  result,
  productName,
  customerName,
  customerPhone,
  locale,
  onNewBooking,
}: BookingResultProps) {
  const { t, lang } = useT();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const { booking, paymentUrl, ticketUrl } = result;
  const payOnline = !!paymentUrl;
  const shareUrl = paymentUrl ?? ticketUrl;
  const message = customerMessage(payOnline ? 'pay' : 'ticket', locale, {
    name: customerName,
    product: productName,
    startsAt: booking.startsAt,
    url: shareUrl,
  });
  const ticket = parseTicketUrl(ticketUrl);
  const ticketHref = ticket
    ? ticketPath(ticket.bookingId, ticket.key, customerLang(locale))
    : ticketUrl;
  const dayKey = dateKeyInTz(booking.startsAt, DEFAULT_TIMEZONE);

  return (
    <div className="flex flex-col gap-4 pt-4">
      <header className="flex items-start gap-3">
        <span className="mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-on-success">
          <IconCheck />
        </span>
        <div className="min-w-0">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
            {payOnline ? t('affiliate.result.created') : t('affiliate.result.confirmed')}
          </h1>
          <p className="text-muted">
            {t('affiliate.result.summary', {
              product: productName,
              day: formatDayLong(dayKey, lang),
              time: formatTime(booking.startsAt, DEFAULT_TIMEZONE, lang),
              customer: booking.customerName,
              reference: booking.reference,
            })}
          </p>
        </div>
      </header>

      <Card>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xl font-bold">
            {payOnline
              ? t('affiliate.result.scanToPay')
              : t('affiliate.result.scanToSave')}
          </p>
          <QrCode
            value={shareUrl}
            label={
              payOnline ? t('affiliate.result.qrPayLabel') : t('affiliate.result.qrTicketLabel')
            }
            className="w-full max-w-80 p-1"
          />
          {payOnline ? (
            <p className="text-lg">
              {t('affiliate.result.totalToPay')}{' '}
              <MoneyText
                amountMinor={booking.totalMinor}
                currency={booking.currency}
                lang={lang}
                className="font-bold"
              />
            </p>
          ) : (
            <p className="text-lg">
              {t('affiliate.result.payOnBoarding')}{' '}
              <MoneyText
                amountMinor={booking.totalMinor}
                currency={booking.currency}
                lang={lang}
                className="font-bold"
              />
            </p>
          )}
          {payOnline ? (
            <p className="text-sm text-muted">
              {t('affiliate.result.held')}
            </p>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-2">
        <ButtonLink
          href={whatsappUrl(message, customerPhone)}
          external
          target="_blank"
          rel="noopener noreferrer"
          size="lg"
          block
          icon={<IconChat />}
        >
          {t('affiliate.result.whatsapp')}
        </ButtonLink>
        <ButtonLink
          href={smsUrl(message, customerPhone)}
          external
          size="lg"
          variant="secondary"
          block
          icon={<IconMessage />}
        >
          {t('affiliate.result.sms')}
        </ButtonLink>
        <ShareActions
          url={shareUrl}
          title={productName}
          text={message.replace(shareUrl, '').trim()}
        />
        <ButtonLink
          href={ticketHref}
          external={!ticket}
          variant="ghost"
          size="lg"
          block
          icon={<IconExternal />}
        >
          {t('affiliate.result.viewTicket')}
        </ButtonLink>
      </div>

      <Button size="lg" variant="secondary" block icon={<IconPlus />} onClick={onNewBooking}>
        {t('affiliate.result.newBooking')}
      </Button>

      <p className="text-center text-sm text-muted">
        {t('affiliate.result.footer', {
          total: formatMoney(booking.totalMinor, booking.currency, lang),
          count: booking.seats,
        })}
      </p>
    </div>
  );
}
