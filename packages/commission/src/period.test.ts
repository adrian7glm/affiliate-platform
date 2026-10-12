import { describe, expect, it } from 'vitest';
import { periodKeyFor, periodRange, previousPeriod } from './period';

describe('commission periods', () => {
  it('resets at midnight in the operator timezone, not in UTC', () => {
    // 22:30 UTC on 31 October is 00:30 on 1 November in Bucharest (UTC+2 after DST ends).
    const instant = new Date('2026-10-31T22:30:00Z');
    expect(periodKeyFor(instant, 'Europe/Bucharest')).toBe('2026-11');
    expect(periodKeyFor(instant, 'UTC')).toBe('2026-10');
  });

  it('returns the UTC range of a month, across a DST change', () => {
    const { start, end } = periodRange('2026-10', 'Europe/Bucharest');
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z'); // UTC+3 in summer
    expect(end.toISOString()).toBe('2026-10-31T22:00:00.000Z'); // UTC+2 in winter
  });

  it('steps back across a year boundary', () => {
    expect(previousPeriod('2027-01')).toBe('2026-12');
  });

  it('rejects unknown timezones and malformed keys', () => {
    expect(() => periodKeyFor(new Date(), 'Mars/Olympus')).toThrow(RangeError);
    expect(() => periodRange('2026-13', 'UTC')).toThrow(RangeError);
  });
});
