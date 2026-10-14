import { bookings } from '@ap/db';
import { type SQL, and, eq, gte, lt } from 'drizzle-orm';

/**
 * What counts as a sale everywhere (commission levels, reports, dashboards): a booking that was
 * paid and not cancelled, counted in the period of its payment. Combine with a tenant or
 * affiliate condition.
 */
export function paidBetween(from: Date, to: Date): SQL {
  return and(
    eq(bookings.status, 'confirmed'),
    gte(bookings.paidAt, from),
    lt(bookings.paidAt, to),
  )!;
}
