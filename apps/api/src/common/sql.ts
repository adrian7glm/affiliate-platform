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

/**
 * `coalesce(sum(x), 0)` as a JavaScript number. Summed in 64 bits: a 32-bit total would overflow
 * past ~21 million in the major unit (amounts are stored in cents/bani).
 */
export function sumMinor(expression: Column | SQL): SQL<number> {
  return sql`coalesce(sum(${expression}), 0)::bigint`.mapWith(Number);
}

/** Like `sumMinor`, over the rows that match `filter` only. */
export function sumMinorWhere(expression: Column | SQL, filter: SQL): SQL<number> {
  return sql`coalesce(sum(${expression}) filter (where ${filter}), 0)::bigint`.mapWith(Number);
}
