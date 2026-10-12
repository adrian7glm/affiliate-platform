import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export * from './schema';
export { schema };

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string, options: PoolConfig = {}): DbHandle {
  const pool = new Pool({ connectionString, max: 10, ...options });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export { runMigrations } from './migrate-lib';
