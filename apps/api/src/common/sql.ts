import { type Column, type SQL, getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * A column with its table name, for correlated subqueries written with `sql`. Drizzle leaves
 * columns unqualified in single-table selects, so inside a subquery `${outer.id}` would silently
 * resolve to the subquery's own `id` column.
 */
export function col(column: Column): SQL {
  return sql`${sql.identifier(getTableName(column.table as PgTable))}.${sql.identifier(column.name)}`;
}
