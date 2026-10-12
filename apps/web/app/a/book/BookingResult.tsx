'use client';

import type { CheckoutResultDto, Locale } from '@ap/contracts';
import { useEffect, useRef } from 'react';
import { Button, ButtonLink } from '@/components/Button';
import { Card } from '@/components/Card';
import { IconChat, IconCheck, IconExternal, IconMessage, IconPlus } from '@/components/icons';
import { MoneyText } from '@/components/MoneyText';
import { QrCode } from '@/components/QrCode';
import { ShareActions } from '@/components/ShareActions';
import { DEFAULT_TIMEZONE, dateKeyInTz, formatDayLong, formatTime } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { pluralRo } from '@/lib/i18n';
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

/** Message for the customer, in their language when we have it (Romanian or English). */
export function customerMessage(
  kind: 'pay' | 'ticket',
  locale: Locale,
  data: { name: string; product: string; startsAt: string; url: string },
): string {
  const lang = locale === 'ro' ? 'ro' : 'en';
  const day = formatDayLong(dateKeyInTz(data.startsAt, DEFAULT_TIMEZONE), lang);
  const time = formatTime(data.startsAt, DEFAULT_TIMEZONE, lang);
  const first = data.name.split(' ')[0] ?? data.name;
  if (lang === 'ro') {
    return kind === 'pay'
      ? `Bună, ${first}! Rezervarea ta pentru ${data.product}, ${day}, ora ${time}, te așteaptă. Plătește aici ca să primești biletul: ${data.url}`
      : `Bună, ${first}! Biletul tău pentru ${data.product}, ${day}, ora ${time}: ${data.url}`;
  }
  return kind === 'pay'
    ? `Hi ${first}! Your booking for ${data.product} on ${day} at ${time} is waiting. Pay here to get your ticket: ${data.url}`
    : `Hi ${first}! Your ticket for ${data.product} on ${day} at ${time}: ${data.url}`;
}

export function BookingResult({
  result,
  productName,
  customerName,
  customerPhone,
  locale,
  onNewBooking,
}: BookingResultProps) {
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
    ? ticketPath(ticket.bookingId, ticket.key, locale === 'ro' ? 'ro' : 'en')
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
            {payOnline ? 'Rezervare creată' : 'Rezervare confirmată'}
          </h1>
          <p className="text-muted">
            {productName} · {formatDayLong(dayKey)}, ora{' '}
            {formatTime(booking.startsAt, DEFAULT_TIMEZONE)} · {booking.customerName} · cod{' '}
            {booking.reference}
          </p>
        </div>
      </header>

      <Card>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-xl font-bold">
            {payOnline
              ? 'Clientul scanează și plătește pe telefonul lui'
              : 'Clientul scanează și își salvează biletul'}
          </p>
          <QrCode
            value={shareUrl}
            label={
              payOnline ? 'Cod QR pentru plata rezervării' : 'Cod QR pentru biletul clientului'
            }
            className="w-full max-w-80 p-1"
          />
          {payOnline ? (
            <p className="text-lg">
              Total de plată:{' '}
              <MoneyText
                amountMinor={booking.totalMinor}
                currency={booking.currency}
                className="font-bold"
              />
            </p>
          ) : (
            <p className="text-lg">
              De plătit la îmbarcare:{' '}
              <MoneyText
                amountMinor={booking.totalMinor}
                currency={booking.currency}
                className="font-bold"
              />
            </p>
          )}
          {payOnline ? (
            <p className="text-sm text-muted">
              Locurile sunt păstrate pentru scurt timp. Biletul ajunge la client imediat după plată.
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
          Trimite pe WhatsApp
        </ButtonLink>
        <ButtonLink
          href={smsUrl(message, customerPhone)}
          external
          size="lg"
          variant="secondary"
          block
          icon={<IconMessage />}
        >
          Trimite SMS
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
          Vezi biletul
        </ButtonLink>
      </div>

      <Button size="lg" variant="secondary" block icon={<IconPlus />} onClick={onNewBooking}>
        Rezervare nouă
      </Button>

      <p className="text-center text-sm text-muted">
        Total {formatMoney(booking.totalMinor, booking.currency)} ·{' '}
        {pluralRo(booking.seats, 'loc', 'locuri')}
      </p>
    </div>
  );
}
