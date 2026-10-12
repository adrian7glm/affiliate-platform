import { DateTime, IANAZone } from 'luxon';

/**
 * Commission periods are calendar months in the operator's timezone, identified by "YYYY-MM".
 * A sale paid at 00:30 on 1 November in Bucharest (22:30 UTC on 31 October) belongs to
 * November, because the operator's month has already reset.
 */
export type PeriodKey = string;

const PERIOD_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

function assertZone(timezone: string): void {
  if (!IANAZone.isValidZone(timezone)) {
    throw new RangeError(`unknown IANA timezone "${timezone}"`);
  }
}

export function periodKeyFor(instant: Date, timezone: string): PeriodKey {
  assertZone(timezone);
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat('yyyy-MM');
}

/** Start (inclusive) and end (exclusive) of a period, as UTC instants. */
export function periodRange(key: PeriodKey, timezone: string): { start: Date; end: Date } {
  assertZone(timezone);
  const match = PERIOD_KEY.exec(key);
  if (!match) throw new RangeError(`period key must look like YYYY-MM, got "${key}"`);
  const start = DateTime.fromObject(
    { year: Number(match[1]), month: Number(match[2]), day: 1 },
    { zone: timezone },
  ).startOf('month');
  return { start: start.toJSDate(), end: start.plus({ months: 1 }).toJSDate() };
}

export function previousPeriod(key: PeriodKey): PeriodKey {
  const match = PERIOD_KEY.exec(key);
  if (!match) throw new RangeError(`period key must look like YYYY-MM, got "${key}"`);
  return DateTime.fromObject(
    { year: Number(match[1]), month: Number(match[2]), day: 1 },
    { zone: 'UTC' },
  )
    .minus({ months: 1 })
    .toFormat('yyyy-MM');
}
