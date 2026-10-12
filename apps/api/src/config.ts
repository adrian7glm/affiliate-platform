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
  NOTIFIER: z.enum(['console', 'silent']).default('console'),
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
});

export type AppConfig = z.infer<typeof schema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${problems}`);
  }
  const config = parsed.data;
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
  return config;
}
