import { HttpStatus } from '@nestjs/common';
import { periodKeyFor } from '@ap/commission';
import { DomainError } from './errors';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?period=YYYY-MM`, defaulting to the current month in the operator's timezone. */
export function periodOrCurrent(period: unknown, now: Date, timezone: string): string {
  if (period === undefined || period === '') return periodKeyFor(now, timezone);
  if (typeof period !== 'string' || !PERIOD.test(period)) {
    throw new DomainError('errors.period.monthFormat', HttpStatus.BAD_REQUEST);
  }
  return period;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateParam(value: unknown, name: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new DomainError('errors.period.dateFormat', HttpStatus.BAD_REQUEST, undefined, { name });
  }
  return value;
}
