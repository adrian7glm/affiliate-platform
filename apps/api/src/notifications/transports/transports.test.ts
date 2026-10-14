import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../config';
import { smtpError } from './smtp';
import { DeliveryError } from './transport';
import { TwilioSmsTransport } from './twilio';

function fakeFetch(
  status: number,
  body: unknown,
  calls: { url: string; init: RequestInit }[] = [],
) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

const twilio = (fetchImpl: typeof fetch, extra: object = {}) =>
  new TwilioSmsTransport({
    accountSid: 'AC123',
    authToken: 'secret',
    from: 'DeltaBoats',
    fetch: fetchImpl,
    ...extra,
  });

describe('Twilio SMS', () => {
  it('posts the message and returns its id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const receipt = await twilio(fakeFetch(201, { sid: 'SM1' }, calls)).send({
      to: '+40722123456',
      text: 'Salut',
    });
    expect(receipt).toEqual({ provider: 'twilio', messageId: 'SM1' });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const body = calls[0]!.init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      To: '+40722123456',
      Body: 'Salut',
      From: 'DeltaBoats',
    });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC123:secret').toString('base64')}`,
    );
  });

  it('uses the messaging service instead of a sender when configured', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await twilio(fakeFetch(201, { sid: 'SM2' }, calls), { messagingServiceSid: 'MG1' }).send({
      to: '+40722123456',
      text: 'x',
    });
    const body = calls[0]!.init.body as URLSearchParams;
    expect(body.get('MessagingServiceSid')).toBe('MG1');
    expect(body.has('From')).toBe(false);
  });

  it('does not retry an invalid number but retries outages and rate limits', async () => {
    const fail = (status: number) =>
      twilio(fakeFetch(status, { code: 21211, message: 'invalid To' }))
        .send({ to: '+40722', text: 'x' })
        .catch((e: DeliveryError) => e);
    expect(await fail(400)).toMatchObject({
      permanent: true,
      message: 'twilio 400 (21211): invalid To',
    });
    expect(await fail(429)).toMatchObject({ permanent: false });
    expect(await fail(503)).toMatchObject({ permanent: false });
    expect(await fail(401)).toMatchObject({ permanent: false });
  });

  it('retries network errors', async () => {
    const offline = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const error = await twilio(offline)
      .send({ to: '+40722123456', text: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect(error).toMatchObject({ permanent: false });
  });
});

describe('SMTP errors', () => {
  it('does not retry rejected recipients', () => {
    expect(
      smtpError({ code: 'EENVELOPE', responseCode: 550, message: 'no such user' }),
    ).toMatchObject({
      permanent: true,
    });
    expect(smtpError({ code: 'EMESSAGE', responseCode: 552 }).permanent).toBe(true);
  });

  it('retries connection, authentication and temporary errors', () => {
    expect(smtpError({ code: 'ECONNECTION', message: 'refused' }).permanent).toBe(false);
    expect(smtpError({ code: 'EAUTH', responseCode: 535 }).permanent).toBe(false);
    expect(smtpError({ code: 'EMESSAGE', responseCode: 451 }).permanent).toBe(false);
  });
});

describe('notification settings', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/x',
    APP_SECRET: 'a-secret-that-is-long-enough-for-production',
  };

  it('works locally with no accounts, also with the empty values of .env.example', () => {
    expect(loadConfig(base)).toMatchObject({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
    expect(loadConfig({ ...base, SMTP_URL: '', TWILIO_FROM: '' })).toMatchObject({
      SMTP_URL: undefined,
    });
  });

  it('asks for the credentials each provider needs', () => {
    expect(() => loadConfig({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow('SMTP_URL');
    expect(() =>
      loadConfig({
        ...base,
        SMS_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'AC1',
        TWILIO_AUTH_TOKEN: 't',
      }),
    ).toThrow('TWILIO_FROM');
  });

  it('refuses to print messages to the log in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      PAYMENTS_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_WEBHOOK_SECRET: 'wh',
    };
    expect(() => loadConfig(production)).toThrow('EMAIL_PROVIDER and SMS_PROVIDER');
    expect(
      loadConfig({
        ...production,
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtps://u:p@smtp.example.com:465',
        SMS_PROVIDER: 'disabled',
      }),
    ).toMatchObject({ EMAIL_PROVIDER: 'smtp', SMS_PROVIDER: 'disabled' });
  });
});
