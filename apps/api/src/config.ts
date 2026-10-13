import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  APP_SECRET: z.string().min(16),
  PAYMENTS_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** console: messages are printed in the API log. smtp: any SMTP provider. disabled: no email. */
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'disabled']).default('console'),
  /** e.g. smtps://user:password@smtp.example.com:465 */
  SMTP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  EMAIL_FROM: z.string().min(3).default('Bilete <no-reply@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),
  /** console: messages are printed in the API log. twilio: real SMS. disabled: no SMS. */
  SMS_PROVIDER: z.enum(['console', 'twilio', 'disabled']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** A Twilio phone number (+40...) or an alphanumeric sender ID of up to 11 characters. */
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  /** Minutes a customer has to pay before the held seats are released. */
  HOLD_MINUTES: z.coerce.number().int().min(1).default(15),
  /** Comma-separated emails that get the platform owner's admin area when they sign in. */
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** true: any operator can create an account at /start. false: by invitation only. */
  SELF_SIGNUP: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** manual: subscriptions are invoiced by hand. stripe: Stripe Billing charges operators' cards. */
  BILLING_PROVIDER: z.enum(['manual', 'stripe']).default('manual'),
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().optional(),
  /** Public URL of this API. Google sends people back to API_URL/auth/google/callback. */
  API_URL: z.string().url().default('http://localhost:4000'),
  /** "Sign in with Google": an OAuth client from Google Cloud Console. Hidden while empty. */
  GOOGLE_CLIENT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /**
   * true: the sign-in page lists the demo accounts (admin, operator, affiliate, scanner) with
   * their passwords. Defaults to true only for local development; turn it off before launch.
   */
  DEMO_MODE: z.enum(['true', 'false']).optional(),
});

type ParsedConfig = z.infer<typeof schema>;
export type AppConfig = Omit<ParsedConfig, 'DEMO_MODE'> & { DEMO_MODE: boolean };

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${problems}`);
  }
  const config: AppConfig = {
    ...parsed.data,
    DEMO_MODE: (parsed.data.DEMO_MODE ?? String(parsed.data.NODE_ENV === 'development')) === 'true',
  };
  if (Boolean(config.GOOGLE_CLIENT_ID) !== Boolean(config.GOOGLE_CLIENT_SECRET)) {
    throw new Error('Sign in with Google needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  }
  if (
    config.PAYMENTS_PROVIDER === 'stripe' &&
    (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET)
  ) {
    throw new Error('PAYMENTS_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
  }
  if (
    config.BILLING_PROVIDER === 'stripe' &&
    (!config.STRIPE_SECRET_KEY || !config.STRIPE_BILLING_WEBHOOK_SECRET)
  ) {
    throw new Error(
      'BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_BILLING_WEBHOOK_SECRET',
    );
  }
  if (config.NODE_ENV === 'production' && config.PAYMENTS_PROVIDER === 'fake') {
    throw new Error('the fake payments provider cannot run in production');
  }
  if (config.EMAIL_PROVIDER === 'smtp' && !config.SMTP_URL) {
    throw new Error('EMAIL_PROVIDER=smtp needs SMTP_URL');
  }
  if (
    config.SMS_PROVIDER === 'twilio' &&
    (!config.TWILIO_ACCOUNT_SID ||
      !config.TWILIO_AUTH_TOKEN ||
      !(config.TWILIO_FROM || config.TWILIO_MESSAGING_SERVICE_SID))
  ) {
    throw new Error(
      'SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID',
    );
  }
  if (
    config.NODE_ENV === 'production' &&
    (config.EMAIL_PROVIDER === 'console' || config.SMS_PROVIDER === 'console')
  ) {
    throw new Error(
      'in production, set EMAIL_PROVIDER and SMS_PROVIDER to a real provider or to disabled',
    );
  }
  return config;
}
