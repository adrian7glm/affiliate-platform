import { type Translator, intlLocale } from '@ap/i18n';
import { DateTime } from 'luxon';

/**
 * Message templates. Every template renders an email (subject, plain text and HTML) and an SMS, in
 * the language of the translator it gets; the texts live in the `email` section of the language
 * files (packages/i18n/src/locales). SMS text is kept to the GSM alphabet (no diacritics) so a message costs one
 * segment per 160 characters instead of one per 70.
 */

interface TripParams {
  tenantName: string;
  productName: string;
  reference: string;
  /** ISO date-time of the departure. */
  startsAt: string;
  /** IANA time zone of the operator, used to print the departure time. */
  timezone: string;
}

export interface TemplateParams {
  login_code: { code: string; webHost: string };
  affiliate_invite: { tenantName: string; url: string };
  operator_invite: { businessName: string; url: string };
  new_operator: { name: string; contact: string; url: string };
  scanner_invite: { tenantName: string; name: string; url: string };
  payment_link: TripParams & { url: string; totalMinor: number; currency: string };
  ticket: TripParams & {
    customerName: string;
    meetingPoint: string | null;
    seats: number;
    url: string;
    /** Signed QR payload; the email shows it as an image. Null when the ticket is not valid. */
    qrToken: string | null;
    amountDueOnSiteMinor: number;
    currency: string;
    /** Ticket types and quantities, printed on the PDF ticket. Missing in older queued messages. */
    items?: { label: string; quantity: number }[];
    /** Operator brand colour for the PDF ticket. */
    brandColor?: string | null;
  };
  booking_cancelled: TripParams & { refunded: boolean };
}

export type TemplateName = keyof TemplateParams;

export const TEMPLATE_NAMES = [
  'login_code',
  'affiliate_invite',
  'operator_invite',
  'new_operator',
  'scanner_invite',
  'payment_link',
  'ticket',
  'booking_cancelled',
] as const satisfies readonly TemplateName[];

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
  sms: string;
  /** QR payload to embed in the email as an inline image (cid:ticket-qr). */
  qr: string | null;
  /** File name of the QR image attachment. */
  qrFileName: string;
}

export const QR_CONTENT_ID = 'ticket-qr';

export function render<T extends TemplateName>(
  template: T,
  t: Translator,
  params: TemplateParams[T],
): RenderedMessage {
  const renderer = renderers[template] as (p: TemplateParams[T], t: Translator) => Parts;
  const parts = renderer(params, t);
  const footer = t.t('email.footer');
  return {
    subject: parts.subject,
    text: [
      ...(parts.greeting ? [parts.greeting, ''] : []),
      ...parts.lines,
      ...(parts.details?.length ? ['', ...parts.details.map(([k, v]) => `${k}: ${v}`)] : []),
      '',
      footer,
    ].join('\n'),
    html: layout(t, parts, footer),
    sms: toGsm(parts.sms),
    qr: parts.qr ?? null,
    qrFileName: `${t.t('email.ticket.qrFileName')}.png`,
  };
}

interface Parts {
  subject: string;
  /** Shown at the top of the email: the operator's name. */
  brand?: string;
  greeting?: string;
  /** Plain text lines. In HTML, URLs become links and the line holding the action URL is
   * left out, since the button replaces it. */
  lines: string[];
  action?: { label: string; url: string };
  details?: [string, string][];
  qr?: string | null;
  sms: string;
}

const renderers: { [K in TemplateName]: (p: TemplateParams[K], t: Translator) => Parts } = {
  login_code: ({ code, webHost }, { t }) => ({
    subject: t('email.loginCode.subject', { code }),
    lines: [
      t('email.loginCode.code', { code }),
      t('email.loginCode.expires'),
      '',
      t('email.loginCode.ignore'),
    ],
    // Last line in the WebOTP format, so Android phones can fill the code in automatically.
    sms: `${t('email.loginCode.sms', { code })}\n\n@${webHost} #${code}`,
  }),

  affiliate_invite: ({ tenantName: tenant, url }, { t }) => ({
    subject: t('email.affiliateInvite.subject', { tenant }),
    brand: tenant,
    greeting: t('email.greeting'),
    lines: [
      t('email.affiliateInvite.intro', { tenant }),
      t('email.affiliateInvite.activate', { url }),
      '',
      t('email.affiliateInvite.expires'),
    ],
    action: { label: t('email.affiliateInvite.action'), url },
    sms: t('email.affiliateInvite.sms', { tenant, url }),
  }),

  operator_invite: ({ businessName: business, url }, { t }) => ({
    subject: t('email.operatorInvite.subject', { business }),
    greeting: t('email.greeting'),
    lines: [
      t('email.operatorInvite.intro', { business }),
      t('email.operatorInvite.open', { url }),
      '',
      t('email.operatorInvite.expires'),
    ],
    action: { label: t('email.operatorInvite.action'), url },
    sms: t('email.operatorInvite.sms', { business, url }),
  }),

  new_operator: ({ name, contact, url }, { t }) => ({
    subject: t('email.newOperator.subject', { name }),
    lines: [t('email.newOperator.intro', { name, contact }), t('email.newOperator.see', { url })],
    action: { label: t('email.newOperator.action'), url },
    sms: t('email.newOperator.sms', { name, contact, url }),
  }),

  scanner_invite: ({ tenantName, name, url }, { t }) => ({
    subject: t('email.scannerInvite.subject', { tenant: tenantName }),
    brand: tenantName,
    greeting: t('email.greetingName', { name }),
    lines: [
      t('email.scannerInvite.intro', { tenant: tenantName }),
      t('email.scannerInvite.signIn', { url }),
    ],
    action: { label: t('email.scannerInvite.action'), url },
    sms: t('email.scannerInvite.sms', { tenant: tenantName, url }),
  }),

  payment_link: (p, tr) => {
    const { t, lang } = tr;
    const when = formatWhen(p.startsAt, p.timezone, tr);
    const total = formatMoney(p.totalMinor, p.currency, lang);
    const trip = { tenant: p.tenantName, product: p.productName };
    return {
      subject: t('email.paymentLink.subject', trip),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines: [
        t('email.paymentLink.held', { ...trip, when }),
        t('email.paymentLink.pay', { total, url: p.url }),
      ],
      action: { label: t('email.paymentLink.action', { total }), url: p.url },
      details: [
        [t('email.details.booking'), p.reference],
        [t('email.details.trip'), p.productName],
        [t('email.details.date'), when],
        [t('email.details.total'), total],
      ],
      sms: t('email.paymentLink.sms', {
        ...trip,
        total,
        when: formatShort(p.startsAt, p.timezone, tr),
        url: p.url,
      }),
    };
  },

  ticket: (p, tr) => {
    const { t, lang } = tr;
    const when = formatWhen(p.startsAt, p.timezone, tr);
    const short = formatShort(p.startsAt, p.timezone, tr);
    const due =
      p.amountDueOnSiteMinor > 0 ? formatMoney(p.amountDueOnSiteMinor, p.currency, lang) : null;
    const details: [string, string][] = [
      [t('email.details.booking'), p.reference],
      [t('email.details.trip'), p.productName],
      [t('email.details.date'), when],
      [t('email.details.seats'), String(p.seats)],
    ];
    if (p.meetingPoint) details.push([t('email.details.meetingPoint'), p.meetingPoint]);
    if (due) details.push([t('email.details.dueOnSite'), due]);
    const sms = {
      tenant: p.tenantName,
      reference: p.reference,
      product: p.productName,
      when: short,
      seats: t('email.seats', { count: p.seats }),
      url: p.url,
    };
    return {
      subject: t('email.ticket.subject', { product: p.productName, when: short }),
      brand: p.tenantName,
      greeting: t('email.greetingName', { name: p.customerName }),
      lines: [
        t('email.ticket.confirmed', { tenant: p.tenantName }),
        t('email.ticket.showQr'),
        t('email.ticket.link', { url: p.url }),
      ],
      action: { label: t('email.ticket.action'), url: p.url },
      details,
      qr: p.qrToken,
      sms: due ? t('email.ticket.smsDue', { ...sms, due }) : t('email.ticket.sms', sms),
    };
  },

  booking_cancelled: (p, tr) => {
    const { t } = tr;
    const vars = {
      tenant: p.tenantName,
      reference: p.reference,
      product: p.productName,
    };
    return {
      subject: t('email.bookingCancelled.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines: [
        t('email.bookingCancelled.cancelled', {
          ...vars,
          when: formatWhen(p.startsAt, p.timezone, tr),
        }),
        ...(p.refunded ? [t('email.bookingCancelled.refunded')] : []),
      ],
      sms: t(p.refunded ? 'email.bookingCancelled.smsRefunded' : 'email.bookingCancelled.sms', {
        ...vars,
        when: formatShort(p.startsAt, p.timezone, tr),
      }),
    };
  },
};

/** The departure in full, in the operator's time zone: "Tuesday 6 October 2026, 10:00". */
export function formatWhen(iso: string, timezone: string, t: Translator): string {
  return DateTime.fromISO(iso, { zone: timezone })
    .setLocale(intlLocale(t.lang))
    .toFormat(t.t('email.format.when'));
}

/** The departure in short, for subjects and SMS: "6 Oct 10:00". */
export function formatShort(iso: string, timezone: string, t: Translator): string {
  return DateTime.fromISO(iso, { zone: timezone })
    .setLocale(intlLocale(t.lang))
    .toFormat(t.t('email.format.short'))
    .replace('.', '');
}

export function formatMoney(minor: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'currency',
    currency,
  }).format(minor / 100);
}

const GSM_REPLACEMENTS: Record<string, string> = {
  ă: 'a',
  â: 'a',
  î: 'i',
  ș: 's',
  ş: 's',
  ț: 't',
  ţ: 't',
  Ă: 'A',
  Â: 'A',
  Î: 'I',
  Ș: 'S',
  Ş: 'S',
  Ț: 'T',
  Ţ: 'T',
  '„': '"',
  '”': '"',
  '“': '"',
  '’': "'",
  '‘': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
  ' ': ' ',
};

/** Replaces Romanian diacritics and typographic punctuation with their GSM-7 equivalents. */
export function toGsm(text: string): string {
  return text
    .replace(/[ăâîșşțţĂÂÎȘŞȚŢ„”“’‘–—…  ]/g, (c) => GSM_REPLACEMENTS[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

/** Escapes a text line and turns its URLs into links. */
function lineHtml(line: string): string {
  return line
    .split(URL_PATTERN)
    .map((part, i) =>
      i % 2 === 1
        ? `<a href="${escapeHtml(part)}" style="color:#0e7490;word-break:break-all">${escapeHtml(part)}</a>`
        : escapeHtml(part),
    )
    .join('');
}

/** A single-column email that reads well on phones and in clients that strip <style>. */
function layout(t: Translator, parts: Parts, footer: string): string {
  const actionUrl = parts.action?.url;
  const paragraphs = [parts.greeting, ...parts.lines]
    .filter((l): l is string => l !== undefined && l !== '')
    .filter((l) => !actionUrl || !l.includes(actionUrl))
    .map((l) => `<p style="margin:0 0 12px">${lineHtml(l)}</p>`)
    .join('');
  const qr = parts.qr
    ? `<div style="text-align:center;margin:20px 0"><img src="cid:${QR_CONTENT_ID}" width="220" height="220" alt="${escapeHtml(t.t('email.qrAlt'))}" style="display:inline-block;width:220px;height:220px"></div>`
    : '';
  const details = parts.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px">${parts.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#64748b;font-size:14px;vertical-align:top;width:45%">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const action = parts.action
    ? `<div style="margin:20px 0"><a href="${escapeHtml(parts.action.url)}" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(parts.action.label)}</a></div>`
    : '';
  const brand = parts.brand
    ? `<p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0e7490;text-align:center">${escapeHtml(parts.brand)}</p>`
    : '';
  return `<!doctype html><html lang="${escapeHtml(t.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(parts.subject)}</title></head><body style="margin:0;padding:0;background:#f1f5f9"><div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0f172a">${brand}<div style="background:#ffffff;border-radius:12px;padding:24px">${paragraphs}${qr}${details}${action}</div><p style="margin:16px 0 0;font-size:12px;color:#64748b;text-align:center">${escapeHtml(footer)}</p></div></body></html>`;
}
