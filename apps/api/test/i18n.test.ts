import type {
  AdminLanguageDto,
  AdminTranslationsDto,
  PublicLanguagesDto,
  PublicMessagesDto,
  SaveTranslationsResultDto,
} from '@ap/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { I18nService } from '../src/i18n/i18n.service';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

/**
 * Translations: the platform admin changes texts and adds languages from the admin area; the
 * web app reads them without signing in, and API errors use them too.
 */
describe.skipIf(!databaseUrl)('translations (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let admin: string;
  const adminEmail = 'adrian@platform.test';

  const as = (token: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${token}`);

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', {
      PLATFORM_ADMIN_EMAILS: adminEmail,
    });
    admin = await signIn(h, adminEmail);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('offers the languages that ship as files, Romanian first', async () => {
    const res = await h.http.get('/i18n/languages').expect(200);
    const codes = (res.body as PublicLanguagesDto).languages.map((l) => l.code);
    expect(codes.slice(0, 2)).toEqual(['ro', 'en']);
    const messages = await h.http.get('/i18n/messages/ro').expect(200);
    expect((messages.body as PublicMessagesDto).messages).toEqual({});
  });

  it('keeps the editor to the platform admin', async () => {
    const owner = await signIn(h, h.ownerEmail);
    await as(owner, 'get', '/admin/i18n/languages').expect(403);
    await h.http.get('/admin/i18n/languages').expect(401);
  });

  it('overrides a text and serves it to the web app', async () => {
    const saved = await as(admin, 'put', '/admin/i18n/languages/ro/texts')
      .send({
        values: {
          'public.book': 'Cumpără bilet',
          'public.fromPrice': 'începând de la {price}',
          'public.seatsLeft_few': 'încă {count} locuri',
          'public.nope': 'x',
          'public.payNow': 'Plătește {suma}',
        },
      })
      .expect(200);
    const result = saved.body as SaveTranslationsResultDto;
    expect(result.saved).toBe(3);
    expect(result.rejected.map((r) => [r.key, r.problem])).toEqual([
      ['public.nope', 'unknown_key'],
      ['public.payNow', 'unknown_placeholder'],
    ]);
    expect(result.language.overrides).toBe(3);

    const messages = (await h.http.get('/i18n/messages/ro').expect(200)).body as PublicMessagesDto;
    expect(messages.messages).toEqual({
      'public.book': 'Cumpără bilet',
      'public.fromPrice': 'începând de la {price}',
      'public.seatsLeft_few': 'încă {count} locuri',
    });
    expect(messages.version).not.toBe('0');

    const texts = (await as(admin, 'get', '/admin/i18n/languages/ro/texts').expect(200))
      .body as AdminTranslationsDto;
    const book = texts.entries.find((e) => e.key === 'public.book')!;
    expect(book).toMatchObject({ reference: 'Book', file: 'Rezervă', override: 'Cumpără bilet' });
    // Romanian plural keys get Romanian forms.
    expect(
      texts.entries.filter((e) => e.key.startsWith('public.seatsLeft_')).map((e) => e.key),
    ).toEqual(['public.seatsLeft_one', 'public.seatsLeft_few', 'public.seatsLeft_other']);
    expect(h.app.get(I18nService).translator('ro').t('public.book')).toBe('Cumpără bilet');

    // Saving the file's text (or nothing) removes the change.
    await as(admin, 'put', '/admin/i18n/languages/ro/texts')
      .send({ values: { 'public.book': 'Rezervă', 'public.fromPrice': null } })
      .expect(200);
    const after = (await h.http.get('/i18n/messages/ro').expect(200)).body as PublicMessagesDto;
    expect(Object.keys(after.messages)).toEqual(['public.seatsLeft_few']);
  });

  it('adds a language, hidden until it is switched on', async () => {
    const created = await as(admin, 'post', '/admin/i18n/languages')
      .send({ code: 'DE', name: 'Deutsch', englishName: 'German' })
      .expect(201);
    expect(created.body as AdminLanguageDto).toMatchObject({
      code: 'de',
      enabled: false,
      bundled: false,
      translated: 0,
    });
    await as(admin, 'post', '/admin/i18n/languages')
      .send({ code: 'de', name: 'Deutsch', englishName: 'German' })
      .expect(409);
    await h.http.get('/i18n/messages/de').expect(404);

    await as(admin, 'put', '/admin/i18n/languages/de/texts')
      .send({ values: { 'public.book': 'Buchen', 'public.seatsLeft_one': 'Noch 1 Platz' } })
      .expect(200);
    await as(admin, 'patch', '/admin/i18n/languages/de').send({ enabled: true }).expect(200);

    const languages = (await h.http.get('/i18n/languages').expect(200)).body as PublicLanguagesDto;
    expect(languages.languages.map((l) => l.code)).toContain('de');
    const de = (await h.http.get('/i18n/messages/de').expect(200)).body as PublicMessagesDto;
    expect(de.messages['public.book']).toBe('Buchen');

    // Errors come back in German where translated, English otherwise.
    const i18n = h.app.get(I18nService);
    expect(i18n.pick('de-AT,de;q=0.9')).toBe('de');
    expect(i18n.translator('de').t('public.noProducts')).toBe('No trips are available right now.');
  });

  it('hides and deletes languages, but never removes English or a language file', async () => {
    await as(admin, 'patch', '/admin/i18n/languages/en').send({ enabled: false }).expect(400);
    await as(admin, 'delete', '/admin/i18n/languages/ro').expect(400);
    await as(admin, 'patch', '/admin/i18n/languages/ro').send({ enabled: false }).expect(200);
    const hidden = (await h.http.get('/i18n/languages').expect(200)).body as PublicLanguagesDto;
    expect(hidden.languages.map((l) => l.code)).not.toContain('ro');
    await as(admin, 'patch', '/admin/i18n/languages/ro').send({ enabled: true }).expect(200);

    await as(admin, 'delete', '/admin/i18n/languages/de').expect(204);
    const list = (await as(admin, 'get', '/admin/i18n/languages').expect(200))
      .body as AdminLanguageDto[];
    expect(list.map((l) => l.code)).toEqual(['ro', 'en']);
  });
});
