import { Logger } from '@nestjs/common';
import { createDb, runMigrations } from '@ap/db';
import { loadDotEnv } from './env';

/** Applies pending migrations. Safe to run from several processes at once (advisory lock). */
export async function migrateDatabase(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await runMigrations(handle);
    new Logger('Migrations').log('database is up to date');
  } finally {
    await handle.close();
  }
}

if (require.main === module) {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  migrateDatabase(url).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
