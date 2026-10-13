import { createDb, runMigrations } from './index';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const handle = createDb(url, { max: 1 });
  try {
    await runMigrations(handle);
    console.log('migrations applied');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
