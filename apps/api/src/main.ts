import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadConfig } from './config';
import { loadDotEnv } from './env';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT);
  new Logger('Bootstrap').log(
    `API listening on port ${config.PORT} (payments: ${config.PAYMENTS_PROVIDER})`,
  );
}

void main();
