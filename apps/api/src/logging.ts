import { ConsoleLogger } from '@nestjs/common';
import type { AppConfig } from './config';

/** Readable lines in development; one JSON object per line in production (or LOG_FORMAT=json). */
export function appLogger(config: AppConfig): ConsoleLogger {
  const json =
    (config.LOG_FORMAT ?? (config.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';
  return new ConsoleLogger({ json, colors: !json });
}
