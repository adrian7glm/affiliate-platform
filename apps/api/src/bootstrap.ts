import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter } from './common/errors';
import type { AppConfig } from './config';

export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableCors({
    origin: [config.WEB_URL],
    allowedHeaders: ['authorization', 'content-type', 'x-tenant-id'],
  });
  app.enableShutdownHooks();
  // Behind a proxy (Railway, Render, Fly) the client IP comes from X-Forwarded-For.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
    'trust proxy',
    1,
  );
  return app;
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.with(config), { rawBody: true });
  return configureApp(app, config);
}
