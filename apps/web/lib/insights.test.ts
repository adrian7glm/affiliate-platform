import type { AffiliateMonthDto, TierProgressDto } from '@ap/contracts';
import { describe, expect, it } from 'vitest';
import {
  averageSaleMinor,
  bestPastMonth,
  daysLeftInPeriod,
  nextTierExtraMinor,
  shortMonth,
} from './insights';

const month = (periodKey: string, paidSales: number, salesMinor: number, commissionMinor = 0) =>
  ({ periodKey, paidSales, salesMinor, commissionMinor }) satisfies AffiliateMonthDto;

describe('daysLeftInPeriod', () => {
  it('counts today', () => {
    expect(daysLeftInPeriod('2026-10', '2026-10-01')).toBe(31);
    expect(daysLeftInPeriod('2026-10', '2026-10-31')).toBe(1);
    expect(daysLeftInPeriod('2026-02', '2026-02-20')).toBe(9);
  });
  it('is zero outside the period', () => {
    expect(daysLeftInPeriod('2026-09', '2026-10-02')).toBe(0);
  });
});

describe('averageSaleMinor', () => {
  it('prefers this month', () => {
    expect(averageSaleMinor([month('2026-09', 1, 90_000), month('2026-10', 2, 30_000)])).toBe(
      15_000,
    );
  });
  it('falls back to the whole history, or null', () => {
    expect(averageSaleMinor([month('2026-09', 2, 40_000), month('2026-10', 0, 0)])).toBe(20_000);
    expect(averageSaleMinor([month('2026-10', 0, 0)])).toBeNull();
  });
});

describe('nextTierExtraMinor', () => {
  const progress: TierProgressDto = {
    paidSales: 2,
    tierIndex: 0,
    tierCount: 3,
    currentRateBps: 1500,
    nextSaleRateBps: 1500,
    nextRateBps: 2000,
    salesToNextTier: 2,
  };
  it('is the rate difference on an average booking', () => {
    expect(nextTierExtraMinor(progress, 30_000)).toBe(1_500);
  });
  it('is null at the top tier or without data', () => {
    expect(nextTierExtraMinor({ ...progress, nextRateBps: null }, 30_000)).toBeNull();
    expect(nextTierExtraMinor(progress, null)).toBeNull();
  });
});

describe('bestPastMonth', () => {
  it('ignores the current month and empty months', () => {
    const history = [
      month('2026-08', 3, 0, 4_000),
      month('2026-09', 5, 0, 9_000),
      month('2026-10', 9, 0, 20_000),
    ];
    expect(bestPastMonth(history)?.periodKey).toBe('2026-09');
    expect(bestPastMonth([month('2026-09', 0, 0), month('2026-10', 1, 0, 100)])).toBeNull();
  });
});

describe('shortMonth', () => {
  it('names the month', () => {
    expect(shortMonth('2026-10')).toBe('oct');
  });
});
