import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiErrorFilter } from './common/errors';
import type { AppConfig } from './config';
import { I18nService } from './i18n/i18n.service';
import { appLogger } from './logging';

export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  app.useGlobalFilters(new ApiErrorFilter(app.get(I18nService)));
  app.enableCors({
    origin: [config.WEB_URL],
    allowedHeaders: ['authorization', 'content-type', 'x-tenant-id'],
  });
  app.enableShutdownHooks();
  // The API only serves JSON, PDFs and calendar files: none of it may be framed or sniffed.
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (config.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      next();
    },
  );
  // Behind a proxy (Railway, Render, Fly) the client IP comes from X-Forwarded-For.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
    'trust proxy',
    1,
  );
  return app;
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.with(config), {
    rawBody: true,
    logger: appLogger(config),
  });
  return configureApp(app, config);
}
