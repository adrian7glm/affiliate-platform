import { createDb, runMigrations } from '@ap/db';
import { loadDotEnv } from './env';

/** Applies pending database migrations using the API's DATABASE_URL. */
async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const handle = createDb(url, { max: 1 });
  try {
    await runMigrations(handle.db);
    console.log('migrations applied');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
