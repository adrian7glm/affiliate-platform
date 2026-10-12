import { describe, expect, it } from 'vitest';
import { compactMoney, dayTicks, niceMax, percentChange, share, tierRatio } from './analytics';

const progress = (paidSales: number, salesToNextTier: number | null) => ({
  paidSales,
  tierIndex: 0,
  tierCount: 3,
  currentRateBps: 1500,
  nextSaleRateBps: 1500,
  nextRateBps: salesToNextTier === null ? null : 2000,
  salesToNextTier,
});

describe('dashboard chart helpers', () => {
  it('rounds the axis up to a readable value', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(87)).toBe(100);
    expect(niceMax(130_000)).toBe(200_000);
    expect(niceMax(2_100)).toBe(2_500);
    expect(niceMax(5_000)).toBe(5_000);
  });

  it('compares with last month only when last month had something', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(10, 0)).toBeNull();
    expect(share(1, 3)).toBe(33);
    expect(share(5, 0)).toBe(0);
  });

  it('shortens axis money', () => {
    expect(compactMoney(0, 'RON')).toBe('0');
    expect(compactMoney(85_000, 'RON')).toBe('850');
    expect(compactMoney(250_000, 'RON', 'en')).toBe('2,500');
    // The compact suffix differs between ICU versions ("12K" or "12k").
    expect(compactMoney(1_200_000, 'RON', 'en')).toMatch(/^12k$/i);
  });

  it('measures the climb to the next tier from the start of the month', () => {
    expect(tierRatio(progress(0, 3))).toBe(0);
    expect(tierRatio(progress(4, 6))).toBe(0.4);
    expect(tierRatio(progress(12, null))).toBe(1);
  });

  it('labels a few days under the columns without crowding', () => {
    expect(dayTicks(31)).toEqual([1, 8, 15, 22, 29]);
    expect(dayTicks(28)).toEqual([1, 8, 15, 22, 28]);
    expect(dayTicks(30)).toEqual([1, 8, 15, 22, 29]);
  });
});
