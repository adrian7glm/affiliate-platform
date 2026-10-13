import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { initErrorReporting } from './common/error-reporting';
import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { appLogger } from './logging';
import { migrateDatabase } from './migrate';

/** The HTTP API. Runs the background jobs too when WORKER_ENABLED=true (local development). */
async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  Logger.overrideLogger(appLogger(config));
  initErrorReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, role: 'api' });
  if (config.MIGRATE_ON_START) await migrateDatabase(config.DATABASE_URL);
  const app = await createApp(config);
  await app.listen(config.PORT);
  new Logger('Bootstrap').log(
    `API listening on port ${config.PORT} (payments: ${config.PAYMENTS_PROVIDER}, background jobs: ${config.WORKER_ENABLED ? 'on' : 'off'})`,
  );
}

void main();
