import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database, DbHandle } from './index';

/** Any number: every process that migrates this database takes the same lock. */
const MIGRATION_LOCK = 7_042_026;

/**
 * Applies every pending migration from packages/db/migrations. Several processes starting at once
 * (API servers and the worker) wait for each other instead of applying the same migration twice.
 */
export async function runMigrations(target: DbHandle | Database): Promise<void> {
  const migrationsFolder = path.resolve(__dirname, '../migrations');
  // A bare Database (older callers): no lock.
  if (!('pool' in target)) return migrate(target, { migrationsFolder });
  const client = await target.pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}
