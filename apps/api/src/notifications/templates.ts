import { DateTime } from 'luxon';

/**
 * Message templates, in Romanian and English. Every template renders an email (subject, plain text
 * and HTML) and an SMS. SMS text is kept to the GSM alphabet (no diacritics) so a message costs one
 * segment per 160 characters instead of one per 70.
 */

export type MessageLang = 'ro' | 'en';

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
}

export const QR_CONTENT_ID = 'ticket-qr';

/** Romanian for Romanian speakers, English for everyone else. */
export function messageLang(locale: string | null | undefined): MessageLang {
  return locale?.toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

export function render<T extends TemplateName>(
  template: T,
  locale: string,
  params: TemplateParams[T],
): RenderedMessage {
  const lang = messageLang(locale);
  const renderer = renderers[template] as (p: TemplateParams[T], l: MessageLang) => Parts;
  const parts = renderer(params, lang);
  return {
    subject: parts.subject,
    text: [
      ...(parts.greeting ? [parts.greeting, ''] : []),
      ...parts.lines,
      ...(parts.details?.length ? ['', ...parts.details.map(([k, v]) => `${k}: ${v}`)] : []),
      '',
      parts.footer ?? footer(lang),
    ]
      .filter((l) => l !== undefined)
      .join('\n'),
    html: layout(lang, parts),
    sms: toGsm(parts.sms),
    qr: parts.qr ?? null,
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
  footer?: string;
  sms: string;
}

const renderers: { [K in TemplateName]: (p: TemplateParams[K], lang: MessageLang) => Parts } = {
  login_code: ({ code, webHost }, lang) =>
    lang === 'ro'
      ? {
          subject: `Codul tău de conectare: ${code}`,
          lines: [
            `Codul tău de conectare este ${code}.`,
            'Expiră în 10 minute. Nu îl da nimănui.',
            '',
            'Dacă nu ai cerut tu acest cod, ignoră mesajul.',
          ],
          // Last line in the WebOTP format, so Android phones can fill the code in automatically.
          sms: `Codul tau de conectare: ${code}. Expira in 10 minute. Nu il da nimanui.\n\n@${webHost} #${code}`,
        }
      : {
          subject: `Your sign-in code: ${code}`,
          lines: [
            `Your sign-in code is ${code}.`,
            'It expires in 10 minutes. Do not share it with anyone.',
            '',
            'If you did not ask for this code, ignore this message.',
          ],
          sms: `Your sign-in code: ${code}. It expires in 10 minutes. Do not share it.\n\n@${webHost} #${code}`,
        },

  affiliate_invite: ({ tenantName, url }, lang) =>
    lang === 'ro'
      ? {
          subject: `${tenantName} te invită în rețeaua de afiliați`,
          brand: tenantName,
          greeting: 'Bună,',
          lines: [
            `${tenantName} te invită să le recomanzi excursiile și să câștigi comision pentru fiecare rezervare.`,
            `Activează-ți contul: ${url}`,
            '',
            'Invitația expiră în 14 zile.',
          ],
          action: { label: 'Activează contul', url },
          sms: `${tenantName} te invita in reteaua lor de afiliati: recomanzi excursii si castigi comision. Activeaza contul: ${url}`,
        }
      : {
          subject: `${tenantName} invites you to their affiliate network`,
          brand: tenantName,
          greeting: 'Hello,',
          lines: [
            `${tenantName} invites you to recommend their trips and earn a commission on every booking.`,
            `Activate your account: ${url}`,
            '',
            'The invitation expires in 14 days.',
          ],
          action: { label: 'Activate your account', url },
          sms: `${tenantName} invites you to their affiliate network: recommend trips and earn commission. Activate: ${url}`,
        },

  scanner_invite: ({ tenantName, name, url }, lang) =>
    lang === 'ro'
      ? {
          subject: `${tenantName}: cont pentru scanarea biletelor`,
          brand: tenantName,
          greeting: `Bună, ${name},`,
          lines: [
            `${tenantName} ți-a făcut un cont pentru scanarea biletelor la îmbarcare.`,
            `Intră cu adresa sau numărul pe care ai primit acest mesaj: ${url}`,
          ],
          action: { label: 'Deschide scanerul', url },
          sms: `${tenantName}: ai un cont pentru scanarea biletelor la imbarcare. Intra cu acest numar: ${url}`,
        }
      : {
          subject: `${tenantName}: your ticket scanning account`,
          brand: tenantName,
          greeting: `Hello ${name},`,
          lines: [
            `${tenantName} created an account for you to scan tickets at boarding.`,
            `Sign in with the address or number this message was sent to: ${url}`,
          ],
          action: { label: 'Open the scanner', url },
          sms: `${tenantName}: you have an account to scan tickets at boarding. Sign in with this number: ${url}`,
        },

  payment_link: (p, lang) => {
    const when = formatWhen(p.startsAt, p.timezone, lang);
    const total = formatMoney(p.totalMinor, p.currency, lang);
    return lang === 'ro'
      ? {
          subject: `${p.tenantName}: finalizează plata pentru ${p.productName}`,
          brand: p.tenantName,
          greeting: 'Bună,',
          lines: [
            `Locurile tale la ${p.productName} (${when}) sunt rezervate temporar.`,
            `Plătește ${total} ca să primești biletul: ${p.url}`,
          ],
          action: { label: `Plătește ${total}`, url: p.url },
          details: [
            ['Rezervare', p.reference],
            ['Excursie', p.productName],
            ['Data', when],
            ['Total', total],
          ],
          sms: `${p.tenantName}: finalizeaza plata (${total}) pentru ${p.productName}, ${formatShort(p.startsAt, p.timezone, lang)}: ${p.url}`,
        }
      : {
          subject: `${p.tenantName}: complete your payment for ${p.productName}`,
          brand: p.tenantName,
          greeting: 'Hello,',
          lines: [
            `Your seats on ${p.productName} (${when}) are held for you.`,
            `Pay ${total} to get your ticket: ${p.url}`,
          ],
          action: { label: `Pay ${total}`, url: p.url },
          details: [
            ['Booking', p.reference],
            ['Trip', p.productName],
            ['Date', when],
            ['Total', total],
          ],
          sms: `${p.tenantName}: complete your payment (${total}) for ${p.productName}, ${formatShort(p.startsAt, p.timezone, lang)}: ${p.url}`,
        };
  },

  ticket: (p, lang) => {
    const when = formatWhen(p.startsAt, p.timezone, lang);
    const short = formatShort(p.startsAt, p.timezone, lang);
    const due =
      p.amountDueOnSiteMinor > 0 ? formatMoney(p.amountDueOnSiteMinor, p.currency, lang) : null;
    if (lang === 'ro') {
      const details: [string, string][] = [
        ['Rezervare', p.reference],
        ['Excursie', p.productName],
        ['Data', when],
        ['Locuri', String(p.seats)],
      ];
      if (p.meetingPoint) details.push(['Punct de întâlnire', p.meetingPoint]);
      if (due) details.push(['De plată la îmbarcare', due]);
      return {
        subject: `Biletul tău: ${p.productName}, ${short}`,
        brand: p.tenantName,
        greeting: `Bună, ${p.customerName},`,
        lines: [
          `Rezervarea ta la ${p.tenantName} este confirmată.`,
          'La îmbarcare arată codul QR din bilet.',
          `Biletul tău: ${p.url}`,
        ],
        action: { label: 'Deschide biletul', url: p.url },
        details,
        qr: p.qrToken,
        sms: `${p.tenantName}: biletul tau ${p.reference} pentru ${p.productName}, ${short}, ${p.seats} ${p.seats === 1 ? 'loc' : 'locuri'}${due ? `, de plata la imbarcare ${due}` : ''}. Arata codul QR la imbarcare: ${p.url}`,
      };
    }
    const details: [string, string][] = [
      ['Booking', p.reference],
      ['Trip', p.productName],
      ['Date', when],
      ['Seats', String(p.seats)],
    ];
    if (p.meetingPoint) details.push(['Meeting point', p.meetingPoint]);
    if (due) details.push(['To pay at boarding', due]);
    return {
      subject: `Your ticket: ${p.productName}, ${short}`,
      brand: p.tenantName,
      greeting: `Hello ${p.customerName},`,
      lines: [
        `Your booking with ${p.tenantName} is confirmed.`,
        'Show the QR code on your ticket at boarding.',
        `Your ticket: ${p.url}`,
      ],
      action: { label: 'Open your ticket', url: p.url },
      details,
      qr: p.qrToken,
      sms: `${p.tenantName}: ticket ${p.reference} for ${p.productName}, ${short}, ${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}${due ? `, to pay at boarding ${due}` : ''}. Show the QR code at boarding: ${p.url}`,
    };
  },

  booking_cancelled: (p, lang) => {
    const when = formatWhen(p.startsAt, p.timezone, lang);
    const short = formatShort(p.startsAt, p.timezone, lang);
    return lang === 'ro'
      ? {
          subject: `Rezervarea ${p.reference} a fost anulată`,
          brand: p.tenantName,
          greeting: 'Bună,',
          lines: [
            `Rezervarea ta ${p.reference} la ${p.productName} (${when}) a fost anulată de ${p.tenantName}. Biletul nu mai este valabil.`,
            ...(p.refunded
              ? ['Banii îți sunt returnați pe card. Pot apărea în cont în 5-10 zile lucrătoare.']
              : []),
          ],
          sms: `${p.tenantName}: rezervarea ${p.reference} (${p.productName}, ${short}) a fost anulata.${p.refunded ? ' Banii iti sunt returnati pe card in 5-10 zile lucratoare.' : ''}`,
        }
      : {
          subject: `Booking ${p.reference} has been cancelled`,
          brand: p.tenantName,
          greeting: 'Hello,',
          lines: [
            `Your booking ${p.reference} for ${p.productName} (${when}) has been cancelled by ${p.tenantName}. The ticket is no longer valid.`,
            ...(p.refunded
              ? [
                  'Your money is being refunded to your card. It can take 5-10 business days to appear.',
                ]
              : []),
          ],
          sms: `${p.tenantName}: booking ${p.reference} (${p.productName}, ${short}) has been cancelled.${p.refunded ? ' Your money is refunded to your card in 5-10 business days.' : ''}`,
        };
  },
};

function footer(lang: MessageLang): string {
  return lang === 'ro'
    ? 'Mesaj trimis automat. Nu răspunde la acest mesaj.'
    : 'This message was sent automatically. Please do not reply.';
}

const LUXON_LOCALE: Record<MessageLang, string> = { ro: 'ro', en: 'en-GB' };

export function formatWhen(iso: string, timezone: string, lang: MessageLang): string {
  return DateTime.fromISO(iso, { zone: timezone })
    .setLocale(LUXON_LOCALE[lang])
    .toFormat(lang === 'ro' ? "cccc, d LLLL yyyy, 'ora' HH:mm" : 'cccc d LLLL yyyy, HH:mm');
}

export function formatShort(iso: string, timezone: string, lang: MessageLang): string {
  return DateTime.fromISO(iso, { zone: timezone })
    .setLocale(LUXON_LOCALE[lang])
    .toFormat('d LLL HH:mm')
    .replace('.', '');
}

export function formatMoney(minor: number, currency: string, lang: MessageLang): string {
  return new Intl.NumberFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
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
function layout(lang: MessageLang, parts: Parts): string {
  const actionUrl = parts.action?.url;
  const paragraphs = [parts.greeting, ...parts.lines]
    .filter((l): l is string => l !== undefined && l !== '')
    .filter((l) => !actionUrl || !l.includes(actionUrl))
    .map((l) => `<p style="margin:0 0 12px">${lineHtml(l)}</p>`)
    .join('');
  const qr = parts.qr
    ? `<div style="text-align:center;margin:20px 0"><img src="cid:${QR_CONTENT_ID}" width="220" height="220" alt="QR" style="display:inline-block;width:220px;height:220px"></div>`
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
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(parts.subject)}</title></head><body style="margin:0;padding:0;background:#f1f5f9"><div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0f172a">${brand}<div style="background:#ffffff;border-radius:12px;padding:24px">${paragraphs}${qr}${details}${action}</div><p style="margin:16px 0 0;font-size:12px;color:#64748b;text-align:center">${escapeHtml(parts.footer ?? footer(lang))}</p></div></body></html>`;
}
