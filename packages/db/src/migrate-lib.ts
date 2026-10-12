import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './index';

/** Applies every pending migration from packages/db/migrations. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
}
