import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/database/database.module';
import { I18nService } from '../src/i18n/i18n.service';
import { type Harness, databaseUrl, startHarness } from './harness';

/** Error messages, emails and SMS in the language of whoever reads them. */
describe.skipIf(!databaseUrl)('translated API texts (needs TEST_DATABASE_URL)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
  });

  afterAll(async () => {
    await h?.close();
  });

  it('answers errors in the language of the request, English by default', async () => {
    const english = await h.http.get('/me').expect(401);
    expect(english.body).toMatchObject({
      code: 'errors.auth.signInAgain',
      message: 'sign in again',
    });

    const romanian = await h.http.get('/me').set('Accept-Language', 'ro-RO,ro;q=0.9').expect(401);
    expect(romanian.body).toMatchObject({
      code: 'errors.auth.signInAgain',
      message: 'conectează-te din nou',
    });

    const unknown = await h.http.get('/me').set('Accept-Language', 'xx').expect(401);
    expect(unknown.body.message).toBe('sign in again');
  });

  it('fills variables and plural forms in translated errors', () => {
    const i18n = h.app.get(I18nService);
    expect(i18n.translate('en', 'errors.departures.seatsLeft', { count: 1 })).toBe(
      'only 1 seat left on this departure',
    );
    expect(i18n.translate('ro', 'errors.departures.seatsLeft', { count: 3 })).toBe(
      'au mai rămas doar 3 locuri la această plecare',
    );
    expect(i18n.translate('ro', 'errors.departures.seatsLeft', { count: 20 })).toBe(
      'au mai rămas doar 20 de locuri la această plecare',
    );
  });

  it('translates validation errors', async () => {
    const response = await h.http
      .post('/auth/otp/request')
      .set('Accept-Language', 'ro')
      .send({ destination: 'not a destination' })
      .expect(400);
    expect(response.body.code).toBe('errors.validation');
    expect(response.body.message).toMatch(/^Verifică aceste câmpuri: destination/);
  });

  it('sends the login code in the language of the login screen, else the browser', async () => {
    await h.http
      .post('/auth/otp/request')
      .send({ destination: 'ro-code@example.com', locale: 'ro' })
      .expect(204);
    expect(h.messages.last('ro-code@example.com')?.subject).toMatch(/^Codul tău de conectare: /);

    await h.http
      .post('/auth/otp/request')
      .set('Accept-Language', 'ro')
      .send({ destination: 'browser-code@example.com' })
      .expect(204);
    expect(h.messages.last('browser-code@example.com')?.subject).toMatch(/^Codul tău/);

    await h.http
      .post('/auth/otp/request')
      .set('Accept-Language', 'ro')
      .send({ destination: 'en-code@example.com', locale: 'en' })
      .expect(204);
    expect(h.messages.last('en-code@example.com')?.subject).toMatch(/^Your sign-in code: /);
  });

  it('writes a ticket email in Romanian for a Romanian customer, English for others', async () => {
    const params = {
      tenantName: 'Delta Boats',
      productName: 'Plimbare pe Dunăre',
      reference: 'ABC123',
      startsAt: '2026-10-06T07:00:00.000Z',
      timezone: 'Europe/Bucharest',
      customerName: 'Ion',
      meetingPoint: 'Ponton 3',
      seats: 2,
      url: 'https://app.test/t/b1?k=key&lang=ro',
      qrToken: 'signed-token',
      amountDueOnSiteMinor: 0,
      currency: 'RON',
    };
    const db = h.app.get(DB);
    await h.notifications.enqueue(db, {
      to: 'ion@example.com',
      template: 'ticket',
      locale: 'ro-RO',
      params,
    });
    await h.notifications.enqueue(db, {
      to: 'hans@example.com',
      template: 'ticket',
      locale: 'de',
      params,
    });
    await h.notifications.deliverDue();

    const ro = h.messages.last('ion@example.com');
    expect(ro?.subject).toBe('Biletul tău: Plimbare pe Dunăre, 6 oct 10:00');
    expect(ro?.text).toContain('Bună, Ion,');
    expect(ro?.text).toContain('marți, 6 octombrie 2026, ora 10:00');
    expect(ro?.html).toContain('<html lang="ro">');
    expect(ro?.attachments).toEqual([
      expect.objectContaining({ filename: 'bilet-qr.png' }),
      expect.objectContaining({ filename: 'bilet-ABC123.pdf', contentType: 'application/pdf' }),
    ]);

    const en = h.messages.last('hans@example.com');
    expect(en?.subject).toBe('Your ticket: Plimbare pe Dunăre, 6 Oct 10:00');
    expect(en?.attachments).toEqual([
      expect.objectContaining({ filename: 'ticket-qr.png' }),
      expect.objectContaining({ filename: 'ticket-ABC123.pdf' }),
    ]);
  });
});
