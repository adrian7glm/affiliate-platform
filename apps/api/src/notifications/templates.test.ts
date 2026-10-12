import { describe, expect, it } from 'vitest';
import { type TemplateParams, messageLang, render, toGsm } from './templates';

const ticket: TemplateParams['ticket'] = {
  tenantName: 'Delta Boats',
  productName: 'Plimbare pe Dunăre',
  reference: 'ABC123',
  startsAt: '2026-10-06T07:00:00.000Z',
  timezone: 'Europe/Bucharest',
  customerName: 'Ion <script>',
  meetingPoint: 'Ponton 3',
  seats: 2,
  url: 'https://app.test/t/b1?k=key&lang=ro',
  qrToken: 'signed-token',
  amountDueOnSiteMinor: 20_000,
  currency: 'RON',
};

describe('message templates', () => {
  it('speaks Romanian to Romanian speakers and English to everyone else', () => {
    expect(messageLang('ro')).toBe('ro');
    expect(messageLang('ro-RO')).toBe('ro');
    expect(messageLang('de')).toBe('en');
    expect(messageLang(undefined)).toBe('en');
  });

  it('renders a Romanian ticket with the departure in the operator time zone', () => {
    const m = render('ticket', 'ro', ticket);
    expect(m.subject).toBe('Biletul tău: Plimbare pe Dunăre, 6 oct 10:00');
    expect(m.text).toContain('marți, 6 octombrie 2026, ora 10:00');
    expect(m.text.replace(/\s/g, ' ')).toContain('De plată la îmbarcare: 200,00 RON');
    expect(m.qr).toBe('signed-token');
    expect(m.html).toContain('cid:ticket-qr');
    expect(m.sms).toBe(
      'Delta Boats: biletul tau ABC123 pentru Plimbare pe Dunare, 6 oct 10:00, 2 locuri, de plata la imbarcare 200,00 RON. Arata codul QR la imbarcare: https://app.test/t/b1?k=key&lang=ro',
    );
  });

  it('renders an English ticket without a QR code when there is none', () => {
    const m = render('ticket', 'en', { ...ticket, qrToken: null, amountDueOnSiteMinor: 0 });
    expect(m.subject).toBe('Your ticket: Plimbare pe Dunăre, 6 Oct 10:00');
    expect(m.text).toContain('Tuesday 6 October 2026, 10:00');
    expect(m.text).not.toContain('To pay at boarding');
    expect(m.qr).toBeNull();
    expect(m.html).not.toContain('cid:');
  });

  it('escapes what customers typed and links URLs in the HTML', () => {
    const { html } = render('ticket', 'en', ticket);
    expect(html).toContain('Hello Ion &lt;script&gt;,');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://app.test/t/b1?k=key&amp;lang=ro"');
  });

  it('puts the login code in the WebOTP format so phones can fill it in', () => {
    const m = render('login_code', 'ro', { code: '123456', webHost: 'app.test' });
    expect(m.subject).toBe('Codul tău de conectare: 123456');
    expect(m.sms.split('\n').at(-1)).toBe('@app.test #123456');
  });

  it('says when a cancelled booking is refunded', () => {
    const base = { ...ticket, refunded: true };
    expect(render('booking_cancelled', 'en', base).text).toContain('being refunded');
    expect(render('booking_cancelled', 'ro', { ...base, refunded: false }).sms).not.toContain(
      'returnati',
    );
  });

  it('keeps SMS text to the GSM alphabet', () => {
    expect(toGsm('Șoseaua „Ștefan” – țară, înapoi… ăâ')).toBe(
      'Soseaua "Stefan" - tara, inapoi... aa',
    );
    for (const template of ['payment_link', 'ticket', 'booking_cancelled'] as const) {
      const m = render(template, 'ro', { ...ticket, totalMinor: 1, refunded: true });
      expect(m.sms).toMatch(/^[\x20-\x7e\n]*$/);
    }
  });
});
