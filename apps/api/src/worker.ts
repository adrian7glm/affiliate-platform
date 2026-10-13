import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { initErrorReporting } from './common/error-reporting';
import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { appLogger } from './logging';
import { migrateDatabase } from './migrate';

/**
 * The background worker: delivers internal events, sends SMS/email, expires unpaid bookings,
 * approves commissions, syncs operators' systems and cleans up old rows. No HTTP server.
 * In production run one worker next to any number of API servers started with WORKER_ENABLED=false.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const config = { ...loadConfig(), WORKER_ENABLED: true };
  Logger.overrideLogger(appLogger(config));
  initErrorReporting({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, role: 'worker' });
  if (config.MIGRATE_ON_START) await migrateDatabase(config.DATABASE_URL);
  const app = await NestFactory.createApplicationContext(AppModule.with(config), {
    logger: appLogger(config),
  });
  app.enableShutdownHooks();
  new Logger('Worker').log('background worker started');
}

void main();
