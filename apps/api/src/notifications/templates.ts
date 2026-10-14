import { type Translator, intlLocale } from '@ap/i18n';
import { DateTime } from 'luxon';
import { googleCalendarUrl } from '../common/calendar';
import { ticketCalendarEvent } from './ticket-calendar';

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
  /** For the platform admins: an internal event stopped being retried. */
  system_alert: { eventId: number; eventType: string; error: string; url: string };
  scanner_invite: { tenantName: string; name: string; url: string };
  payment_link: TripParams & { url: string; totalMinor: number; currency: string };
  ticket: TripParams & {
    customerName: string;
    meetingPoint: string | null;
    /** The operator's message for the trip's customers. Missing in older queued messages. */
    customerNote?: string | null;
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
    /** End of the trip, for the calendar event. Missing in older queued messages. */
    endsAt?: string;
  };
  booking_cancelled: TripParams & {
    refunded: boolean;
    /** Why the operator cancelled: the customer is told, e.g. bad weather. */
    reason?: 'weather' | 'other' | null;
    /** The operator's own words for the customer. */
    message?: string | null;
  };
  /** Sent to the account's existing phone and email when its sign-in security changes. */
  security_alert: {
    event: 'contact_added' | 'two_factor_on' | 'two_factor_off' | 'two_factor_reset';
    /** The new phone number or email, masked (contact_added). */
    contact?: string;
    url: string;
  };
  contact_request: {
    topic: 'demo' | 'question';
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
    message: string;
    url: string;
  };
  // Retention: messages nobody asked for, sent so customers show up, come back and talk about
  // the trip, affiliates keep selling, and operators see what the platform brings them.
  trip_reminder: TripParams & {
    customerName: string;
    meetingPoint: string | null;
    url: string;
    contactPhone: string | null;
  };
  review_request: {
    tenantName: string;
    productName: string;
    customerName: string;
    reviewUrl: string;
  };
  affiliate_sale: {
    tenantName: string;
    productName: string;
    startsAt: string;
    timezone: string;
    seats: number;
    commissionMinor: number;
    currency: string;
    /** Paid sales this month, this one included. */
    salesThisMonth: number;
    /** Set when this sale opened a higher commission level. */
    reachedRateBps: number | null;
    /** Sales still needed for the next level; null on the top level or a fixed rate. */
    salesToNextTier: number | null;
    nextRateBps: number | null;
    url: string;
  };
  affiliate_tier_nudge: {
    tenantName: string;
    salesToNextTier: number;
    nextRateBps: number;
    /** ISO date-time when the monthly count starts again. */
    resetsAt: string;
    timezone: string;
    url: string;
  };
  payout_paid: {
    tenantName: string;
    amountMinor: number;
    currency: string;
    periodKey: string;
    url: string;
  };
  monthly_report: {
    tenantName: string;
    periodKey: string;
    previousPeriodKey: string;
    currency: string;
    bookings: number;
    revenueMinor: number;
    previousRevenueMinor: number;
    affiliateBookings: number;
    affiliateRevenueMinor: number;
    commissionMinor: number;
    payableMinor: number;
    activeAffiliates: number;
    topAffiliates: { name: string; sales: number }[];
    url: string;
    payoutsUrl: string;
  };
  trial_ending: { tenantName: string; endsAt: string; timezone: string; url: string };
  subscription_unpaid: {
    tenantName: string;
    /** trial: the free trial ended; payment: a card payment failed; expired: the paid-until
     *  date passed; canceled: the subscription was cancelled. */
    reason: 'trial' | 'payment' | 'expired' | 'canceled';
    /** When new bookings pause. */
    pauseAt: string;
    timezone: string;
    url: string;
  };
  sales_paused: { tenantName: string; url: string };
}

export type TemplateName = keyof TemplateParams;

export const TEMPLATE_NAMES = [
  'login_code',
  'affiliate_invite',
  'operator_invite',
  'new_operator',
  'system_alert',
  'scanner_invite',
  'payment_link',
  'ticket',
  'booking_cancelled',
  'contact_request',
  'security_alert',
  'trip_reminder',
  'review_request',
  'affiliate_sale',
  'affiliate_tier_nudge',
  'payout_paid',
  'monthly_report',
  'trial_ending',
  'subscription_unpaid',
  'sales_paused',
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
      ...(parts.links?.length ? ['', ...parts.links.map((l) => `${l.label}: ${l.url}`)] : []),
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
  /** Secondary links under the button, e.g. "Add to Google Calendar". */
  links?: { label: string; url: string }[];
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

  system_alert: ({ eventId, eventType, error, url }, { t }) => ({
    subject: t('email.systemAlert.subject', { type: eventType }),
    lines: [
      t('email.systemAlert.intro', { type: eventType, id: eventId }),
      t('email.systemAlert.error', { error }),
      t('email.systemAlert.next'),
    ],
    action: { label: t('email.systemAlert.action'), url },
    sms: t('email.systemAlert.sms', { type: eventType, url }),
  }),

  security_alert: ({ event, contact = '', url }, { t, tk }) => {
    const key = {
      contact_added: 'contactAdded',
      two_factor_on: 'twoFactorOn',
      two_factor_off: 'twoFactorOff',
      two_factor_reset: 'twoFactorReset',
    }[event];
    return {
      subject: tk(`email.securityAlert.${key}Subject`),
      greeting: t('email.greeting'),
      lines: [
        tk(`email.securityAlert.${key}`, { contact }),
        '',
        t('email.securityAlert.notYou', { url }),
      ],
      action: { label: t('email.securityAlert.action'), url },
      sms: `${tk(`email.securityAlert.${key}`, { contact })} ${t('email.securityAlert.notYou', { url })}`,
    };
  },

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
    const calendar =
      p.endsAt && p.qrToken ? ticketCalendarEvent({ ...p, endsAt: p.endsAt }, tr) : null;
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
        ...(p.customerNote
          ? [t('email.ticket.note', { tenant: p.tenantName, note: p.customerNote })]
          : []),
        t('email.ticket.showQr'),
        t('email.ticket.link', { url: p.url }),
        ...(calendar ? [t('email.ticket.calendarAttached')] : []),
      ],
      action: { label: t('email.ticket.action'), url: p.url },
      links: calendar
        ? [{ label: t('email.ticket.addToGoogle'), url: googleCalendarUrl(calendar) }]
        : undefined,
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
        ...(p.reason === 'weather' ? [t('email.bookingCancelled.weather')] : []),
        ...(p.message ? [t('email.bookingCancelled.message', { message: p.message })] : []),
        ...(p.refunded ? [t('email.bookingCancelled.refunded')] : []),
        ...(p.reason ? [t('email.bookingCancelled.sorry')] : []),
      ],
      sms: t(
        p.reason === 'weather'
          ? p.refunded
            ? 'email.bookingCancelled.smsWeatherRefunded'
            : 'email.bookingCancelled.smsWeather'
          : p.refunded
            ? 'email.bookingCancelled.smsRefunded'
            : 'email.bookingCancelled.sms',
        { ...vars, when: formatShort(p.startsAt, p.timezone, tr) },
      ),
    };
  },

  contact_request: (p, { t }) => {
    const topic = t(
      p.topic === 'demo' ? 'email.contactRequest.demo' : 'email.contactRequest.question',
    );
    const details: [string, string][] = [
      [t('email.contactRequest.name'), p.name],
      [t('email.contactRequest.email'), p.email],
    ];
    if (p.phone) details.push([t('email.contactRequest.phone'), p.phone]);
    if (p.company) details.push([t('email.contactRequest.company'), p.company]);
    return {
      subject: t('email.contactRequest.subject', { topic, name: p.name }),
      lines: [
        t('email.contactRequest.intro', { topic, name: p.name }),
        ...(p.message ? ['', p.message] : []),
      ],
      action: { label: t('email.contactRequest.action'), url: p.url },
      details,
      sms: t('email.contactRequest.sms', { topic, name: p.name, contact: p.phone ?? p.email }),
    };
  },
  trip_reminder: (p, tr) => {
    const { t } = tr;
    const when = formatWhen(p.startsAt, p.timezone, tr);
    const vars = {
      tenant: p.tenantName,
      product: p.productName,
      when: formatShort(p.startsAt, p.timezone, tr),
      url: p.url,
    };
    const details: [string, string][] = [
      [t('email.details.booking'), p.reference],
      [t('email.details.trip'), p.productName],
      [t('email.details.date'), when],
    ];
    if (p.meetingPoint) details.push([t('email.details.meetingPoint'), p.meetingPoint]);
    return {
      subject: t('email.tripReminder.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greetingName', { name: p.customerName }),
      lines: [
        t('email.tripReminder.intro', { ...vars, when }),
        ...(p.meetingPoint
          ? [t('email.tripReminder.meetingPoint', { meetingPoint: p.meetingPoint })]
          : []),
        t('email.tripReminder.showQr'),
        t('email.ticket.link', { url: p.url }),
        ...(p.contactPhone ? [t('email.tripReminder.contact', { phone: p.contactPhone })] : []),
      ],
      action: { label: t('email.tripReminder.action'), url: p.url },
      details,
      sms: p.meetingPoint
        ? t('email.tripReminder.sms', { ...vars, meetingPoint: p.meetingPoint })
        : t('email.tripReminder.smsNoMeetingPoint', vars),
    };
  },

  review_request: (p, { t }) => {
    const vars = { tenant: p.tenantName, product: p.productName, url: p.reviewUrl };
    return {
      subject: t('email.reviewRequest.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greetingName', { name: p.customerName }),
      lines: [
        t('email.reviewRequest.thanks', vars),
        t('email.reviewRequest.ask'),
        t('email.reviewRequest.link', vars),
      ],
      action: { label: t('email.reviewRequest.action'), url: p.reviewUrl },
      sms: t('email.reviewRequest.sms', vars),
    };
  },

  affiliate_sale: (p, tr) => {
    const { t, lang } = tr;
    const amount = formatMoney(p.commissionMinor, p.currency, lang);
    const vars = {
      tenant: p.tenantName,
      product: p.productName,
      when: formatShort(p.startsAt, p.timezone, tr),
      amount,
    };
    const reached = p.reachedRateBps !== null ? formatRate(p.reachedRateBps, lang) : null;
    const next =
      p.salesToNextTier !== null && p.nextRateBps !== null
        ? { count: p.salesToNextTier, rate: formatRate(p.nextRateBps, lang) }
        : null;
    return {
      subject: t('email.affiliateSale.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines: [
        t('email.affiliateSale.intro', { ...vars, seats: t('email.seats', { count: p.seats }) }),
        t('email.affiliateSale.commission', vars),
        t('email.affiliateSale.month', { count: p.salesThisMonth }),
        ...(reached ? [t('email.affiliateSale.reached', { rate: reached })] : []),
        ...(next ? [t('email.affiliateSale.toNext', next)] : []),
        t('email.affiliateSale.link', { url: p.url }),
      ],
      action: { label: t('email.affiliateSale.action'), url: p.url },
      sms: reached
        ? t('email.affiliateSale.smsReached', { ...vars, rate: reached })
        : next
          ? t('email.affiliateSale.smsToNext', { ...vars, ...next })
          : t('email.affiliateSale.sms', vars),
    };
  },

  affiliate_tier_nudge: (p, tr) => {
    const { t, lang } = tr;
    const vars = {
      tenant: p.tenantName,
      count: p.salesToNextTier,
      rate: formatRate(p.nextRateBps, lang),
      date: formatDay(p.resetsAt, p.timezone, tr),
      url: p.url,
    };
    return {
      subject: t('email.tierNudge.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines: [
        t('email.tierNudge.intro', vars),
        t('email.tierNudge.resets', vars),
        t('email.tierNudge.tip'),
        t('email.tierNudge.link', vars),
      ],
      action: { label: t('email.tierNudge.action'), url: p.url },
      sms: t('email.tierNudge.sms', vars),
    };
  },

  payout_paid: (p, tr) => {
    const { t, lang } = tr;
    const vars = {
      tenant: p.tenantName,
      amount: formatMoney(p.amountMinor, p.currency, lang),
      period: formatPeriodKey(p.periodKey, tr),
    };
    return {
      subject: t('email.payoutPaid.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines: [
        t('email.payoutPaid.intro', vars),
        t('email.payoutPaid.details', { url: p.url }),
        t('email.payoutPaid.thanks'),
      ],
      action: { label: t('email.payoutPaid.action'), url: p.url },
      sms: t('email.payoutPaid.sms', vars),
    };
  },

  monthly_report: (p, tr) => {
    const { t, lang } = tr;
    const money = (minor: number) => formatMoney(minor, p.currency, lang);
    const period = formatPeriodKey(p.periodKey, tr);
    const vars = { tenant: p.tenantName, period };
    const lines = [t('email.monthlyReport.intro', vars)];
    if (p.previousRevenueMinor > 0) {
      lines.push(
        t('email.monthlyReport.compared', {
          previous: formatPeriodKey(p.previousPeriodKey, tr),
          change: formatChange(p.revenueMinor, p.previousRevenueMinor, lang),
        }),
      );
    }
    if (p.affiliateRevenueMinor > 0) {
      lines.push(
        t('email.monthlyReport.affiliates', {
          amount: money(p.affiliateRevenueMinor),
          share: formatShare(p.affiliateRevenueMinor, p.revenueMinor, lang),
        }),
      );
    } else {
      lines.push(t('email.monthlyReport.noAffiliateSales'));
    }
    if (p.topAffiliates.length > 0) {
      lines.push(
        t('email.monthlyReport.top', {
          list: p.topAffiliates.map((a) => `${a.name} (${a.sales})`).join(', '),
        }),
      );
    }
    if (p.payableMinor > 0) {
      lines.push(
        t('email.monthlyReport.payable', { amount: money(p.payableMinor), url: p.payoutsUrl }),
      );
    }
    lines.push(t('email.monthlyReport.link', { url: p.url }));
    return {
      subject: t('email.monthlyReport.subject', vars),
      brand: p.tenantName,
      greeting: t('email.greeting'),
      lines,
      action: { label: t('email.monthlyReport.action'), url: p.url },
      details: [
        [t('email.monthlyReport.bookings'), String(p.bookings)],
        [t('email.monthlyReport.revenue'), money(p.revenueMinor)],
        [
          t('email.monthlyReport.fromAffiliates'),
          t('email.monthlyReport.fromAffiliatesValue', {
            amount: money(p.affiliateRevenueMinor),
            count: p.affiliateBookings,
          }),
        ],
        [t('email.monthlyReport.commissions'), money(p.commissionMinor)],
        [t('email.monthlyReport.activeAffiliates'), String(p.activeAffiliates)],
      ],
      sms: t('email.monthlyReport.sms', {
        ...vars,
        bookings: p.bookings,
        revenue: money(p.revenueMinor),
        affiliates: money(p.affiliateRevenueMinor),
        url: p.url,
      }),
    };
  },

  trial_ending: (p, tr) => {
    const { t } = tr;
    const vars = { tenant: p.tenantName, date: formatDay(p.endsAt, p.timezone, tr), url: p.url };
    return {
      subject: t('email.trialEnding.subject', vars),
      greeting: t('email.greeting'),
      lines: [
        t('email.trialEnding.intro', vars),
        t('email.trialEnding.keepSelling'),
        t('email.trialEnding.link', vars),
      ],
      action: { label: t('email.trialEnding.action'), url: p.url },
      sms: t('email.trialEnding.sms', vars),
    };
  },

  subscription_unpaid: (p, tr) => {
    const { t } = tr;
    const vars = { tenant: p.tenantName, date: formatDay(p.pauseAt, p.timezone, tr), url: p.url };
    const reason = {
      trial: 'email.subscriptionUnpaid.trial',
      payment: 'email.subscriptionUnpaid.payment',
      expired: 'email.subscriptionUnpaid.expired',
      canceled: 'email.subscriptionUnpaid.canceled',
    } as const;
    return {
      subject: t('email.subscriptionUnpaid.subject', vars),
      greeting: t('email.greeting'),
      lines: [
        t(reason[p.reason], vars),
        t('email.subscriptionUnpaid.pause', vars),
        t('email.subscriptionUnpaid.valid'),
        t('email.subscriptionUnpaid.link', vars),
      ],
      action: { label: t('email.subscriptionUnpaid.action'), url: p.url },
      sms: t('email.subscriptionUnpaid.sms', vars),
    };
  },

  sales_paused: (p, { t }) => {
    const vars = { tenant: p.tenantName, url: p.url };
    return {
      subject: t('email.salesPaused.subject', vars),
      greeting: t('email.greeting'),
      lines: [
        t('email.salesPaused.intro', vars),
        t('email.salesPaused.valid'),
        t('email.salesPaused.resume'),
        t('email.salesPaused.link', vars),
      ],
      action: { label: t('email.salesPaused.action'), url: p.url },
      sms: t('email.salesPaused.sms', vars),
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

/** A day in the operator's time zone: "Tuesday 6 October 2026". */
export function formatDay(iso: string, timezone: string, t: Translator): string {
  return DateTime.fromISO(iso, { zone: timezone })
    .setLocale(intlLocale(t.lang))
    .toFormat(t.t('email.format.day'));
}

/** A month: "October 2026". */
export function formatPeriodKey(periodKey: string, t: Translator): string {
  return DateTime.fromFormat(periodKey, 'yyyy-MM', { zone: 'UTC' })
    .setLocale(intlLocale(t.lang))
    .toFormat('LLLL yyyy');
}

/** A commission rate in basis points: 2000 → "20%". */
export function formatRate(bps: number, lang: string): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/** Part of a whole as a rounded percentage: "64%". */
function formatShare(part: number, whole: number, lang: string): string {
  return new Intl.NumberFormat(intlLocale(lang), { style: 'percent' }).format(
    whole > 0 ? part / whole : 0,
  );
}

/** Change from one amount to another, signed: "+12%", "-5%". */
function formatChange(current: number, previous: number, lang: string): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: 'percent',
    signDisplay: 'exceptZero',
  }).format((current - previous) / previous);
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
  '\u00a0': ' ',
  '\u202f': ' ',
};

/** Replaces Romanian diacritics and typographic punctuation with their GSM-7 equivalents. */
export function toGsm(text: string): string {
  return text
    .replace(/[ăâîșşțţĂÂÎȘŞȚŢ„”“’‘–—…\u00a0\u202f]/g, (c) => GSM_REPLACEMENTS[c] ?? c)
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
  const links = parts.links?.length
    ? `<p style="margin:-8px 0 16px;font-size:14px">${parts.links
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}" style="color:#0e7490;font-weight:600">${escapeHtml(l.label)}</a>`,
        )
        .join(' · ')}</p>`
    : '';
  const action = parts.action
    ? `<div style="margin:20px 0"><a href="${escapeHtml(parts.action.url)}" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(parts.action.label)}</a></div>`
    : '';
  const brand = parts.brand
    ? `<p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0e7490;text-align:center">${escapeHtml(parts.brand)}</p>`
    : '';
  return `<!doctype html><html lang="${escapeHtml(t.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(parts.subject)}</title></head><body style="margin:0;padding:0;background:#f1f5f9"><div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0f172a">${brand}<div style="background:#ffffff;border-radius:12px;padding:24px">${paragraphs}${qr}${details}${action}${links}</div><p style="margin:16px 0 0;font-size:12px;color:#64748b;text-align:center">${escapeHtml(footer)}</p></div></body></html>`;
}
