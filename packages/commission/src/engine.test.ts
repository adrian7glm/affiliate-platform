import { describe, expect, it } from 'vitest';
import {
  type CommissionPlan,
  type LedgerEntry,
  type Sale,
  applyRate,
  buildPayout,
  commissionAtSale,
  computePeriodCommissions,
  effectivePlan,
  isApprovable,
  percentToBps,
  rateForSale,
  reconcile,
  reversalFor,
  tierProgress,
  validatePlan,
} from './index';

const tiers = [
  { fromSale: 1, rateBps: 1500 },
  { fromSale: 4, rateBps: 2000 },
  { fromSale: 11, rateBps: 2500 },
];
const marginal: CommissionPlan = { kind: 'tiered', mode: 'marginal', tiers, basis: 'gross' };
const retroactive: CommissionPlan = { kind: 'tiered', mode: 'retroactive', tiers, basis: 'gross' };

/** n sales of 100 lei (10000 bani) each, one hour apart. */
function sales(n: number, cancelled: number[] = []): Sale[] {
  return Array.from({ length: n }, (_, i) => ({
    bookingId: `b${String(i + 1).padStart(2, '0')}`,
    paidAt: new Date(Date.UTC(2026, 9, 1, i)),
    grossMinor: 10_000,
    taxMinor: 0,
    cancelled: cancelled.includes(i + 1),
  }));
}

function total(list: { amountMinor: number }[]): number {
  return list.reduce((sum, item) => sum + item.amountMinor, 0);
}

let nextId = 0;
function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, 'bookingId' | 'amountMinor'>): LedgerEntry {
  nextId += 1;
  return { id: `e${nextId}`, kind: 'sale', status: 'pending', rateBps: 0, baseMinor: 10_000, ...partial };
}

describe('money', () => {
  it('applies rates in basis points with half-up rounding', () => {
    expect(applyRate(10_000, 1500)).toBe(1500);
    expect(applyRate(333, 1500)).toBe(50); // 49.95 -> 50
    expect(applyRate(330, 1500)).toBe(50); // 49.5 -> 50
    expect(applyRate(329, 1500)).toBe(49); // 49.35 -> 49
    expect(applyRate(-333, 1500)).toBe(-50);
    expect(applyRate(0, 2500)).toBe(0);
  });

  it('rejects fractional amounts and out-of-range rates', () => {
    expect(() => applyRate(10.5, 1500)).toThrow(RangeError);
    expect(() => applyRate(100, 10_001)).toThrow(RangeError);
    expect(() => applyRate(100, -1)).toThrow(RangeError);
  });

  it('converts percentages to basis points', () => {
    expect(percentToBps(20)).toBe(2000);
    expect(percentToBps(12.5)).toBe(1250);
    expect(() => percentToBps(101)).toThrow(RangeError);
  });
});

describe('plans', () => {
  it('accepts the plans from the product brief', () => {
    expect(() => validatePlan(marginal)).not.toThrow();
    expect(() => validatePlan({ kind: 'fixed', rateBps: 2000, basis: 'gross' })).not.toThrow();
  });

  it('rejects malformed tiers', () => {
    const bad = (t: typeof tiers): CommissionPlan => ({ kind: 'tiered', mode: 'marginal', tiers: t, basis: 'gross' });
    expect(() => validatePlan(bad([]))).toThrow(/at least one tier/);
    expect(() => validatePlan(bad([{ fromSale: 2, rateBps: 1500 }]))).toThrow(/start at sale 1/);
    expect(() =>
      validatePlan(bad([{ fromSale: 1, rateBps: 1500 }, { fromSale: 1, rateBps: 2000 }])),
    ).toThrow(/strictly increasing/);
  });

  it('gives each sale the rate of its tier', () => {
    expect([1, 3, 4, 10, 11, 50].map((n) => rateForSale(marginal, n))).toEqual([
      1500, 1500, 2000, 2000, 2500, 2500,
    ]);
  });

  it('lets a negotiated rate override the default plan', () => {
    expect(effectivePlan(marginal, 2500)).toEqual({ kind: 'fixed', rateBps: 2500, basis: 'gross' });
    expect(effectivePlan(marginal, null)).toBe(marginal);
  });
});

describe('fixed plans', () => {
  it('pays each affiliate their negotiated rate', () => {
    const rates = [2000, 1500, 2500];
    const earned = rates.map(
      (rateBps) => computePeriodCommissions({ kind: 'fixed', rateBps, basis: 'gross' }, sales(5)),
    );
    expect(earned.map(total)).toEqual([10_000, 7500, 12_500]);
  });

  it('can exclude VAT from the base', () => {
    const plan: CommissionPlan = { kind: 'fixed', rateBps: 2000, basis: 'net_of_tax' };
    const result = commissionAtSale(plan, { bookingId: 'b1', grossMinor: 11_900, taxMinor: 1900 }, 0);
    expect(result).toMatchObject({ baseMinor: 10_000, amountMinor: 2000 });
  });
});

describe('progressive plans: 12 sales of 100 lei (example from the architecture doc)', () => {
  it('marginal: 3 x 15% + 7 x 20% + 2 x 25% = 235 lei', () => {
    const result = computePeriodCommissions(marginal, sales(12));
    expect(total(result)).toBe(23_500);
    expect(result.map((r) => r.rateBps)).toEqual([
      1500, 1500, 1500, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2500, 2500,
    ]);
  });

  it('retroactive: all 12 sales at 25% = 300 lei', () => {
    expect(total(computePeriodCommissions(retroactive, sales(12)))).toBe(30_000);
  });

  it('marginal: the live commission equals the final one, so nothing needs reconciling', () => {
    const live = sales(12).map((sale, i) => commissionAtSale(marginal, sale, i));
    const ledger = live.map((c) => entry({ bookingId: c.bookingId, amountMinor: c.amountMinor, rateBps: c.rateBps }));
    expect(reconcile(computePeriodCommissions(marginal, sales(12)), ledger)).toEqual([]);
  });

  it('retroactive: the period close uplifts earlier sales to the tier reached', () => {
    const live = sales(11).map((sale, i) => commissionAtSale(retroactive, sale, i));
    const ledger = live.map((c) => entry({ bookingId: c.bookingId, amountMinor: c.amountMinor, rateBps: c.rateBps }));
    expect(total(ledger)).toBe(3 * 1500 + 7 * 2000 + 2500);

    const adjustments = reconcile(computePeriodCommissions(retroactive, sales(11)), ledger);
    expect(adjustments).toHaveLength(10);
    expect(adjustments.slice(0, 3).every((a) => a.amountMinor === 1000)).toBe(true);
    expect(adjustments.slice(3).every((a) => a.amountMinor === 500)).toBe(true);
    expect(total(ledger) + total(adjustments)).toBe(11 * 2500);
  });

  it('does not count cancelled bookings towards the tier', () => {
    // Sale #2 is cancelled, so the 4th booking is only the 3rd sale and stays at 15%.
    const result = computePeriodCommissions(marginal, sales(4, [2]));
    expect(result.map((r) => r.saleNumber)).toEqual([1, null, 2, 3]);
    expect(result.map((r) => r.amountMinor)).toEqual([1500, 0, 1500, 1500]);
  });

  it('re-tiers after a cancellation earlier in the month', () => {
    const live = sales(4).map((sale, i) => commissionAtSale(marginal, sale, i));
    const ledger = live.map((c) => entry({ bookingId: c.bookingId, amountMinor: c.amountMinor, rateBps: c.rateBps }));
    const reversal = reversalFor(ledger, 'b02', 'refund');
    expect(reversal).toMatchObject({ kind: 'reversal', amountMinor: -1500 });
    ledger.push(entry({ ...reversal!, kind: 'reversal' }));

    const adjustments = reconcile(computePeriodCommissions(marginal, sales(4, [2])), ledger);
    expect(adjustments).toEqual([
      expect.objectContaining({ bookingId: 'b04', kind: 'adjustment', amountMinor: -500 }),
    ]);
  });

  it('orders sales by payment time, not by input order', () => {
    const shuffled = sales(4).reverse();
    expect(computePeriodCommissions(marginal, shuffled).map((r) => r.bookingId)).toEqual([
      'b01', 'b02', 'b03', 'b04',
    ]);
  });
});

describe('tier progress shown to the affiliate', () => {
  it('tells how many sales are left to the next tier', () => {
    expect(tierProgress(marginal, 0)).toMatchObject({
      tierIndex: 0, currentRateBps: 1500, nextSaleRateBps: 1500, nextRateBps: 2000, salesToNextTier: 4,
    });
    expect(tierProgress(marginal, 2)).toMatchObject({ currentRateBps: 1500, salesToNextTier: 2 });
    expect(tierProgress(marginal, 3)).toMatchObject({
      currentRateBps: 1500, nextSaleRateBps: 2000, nextRateBps: 2000, salesToNextTier: 1,
    });
    expect(tierProgress(marginal, 10)).toMatchObject({ tierIndex: 1, nextRateBps: 2500, salesToNextTier: 1 });
    expect(tierProgress(marginal, 11)).toMatchObject({
      tierIndex: 2, currentRateBps: 2500, nextRateBps: null, salesToNextTier: null,
    });
  });

  it('has no next tier on a fixed plan', () => {
    expect(tierProgress({ kind: 'fixed', rateBps: 2000, basis: 'gross' }, 7)).toMatchObject({
      currentRateBps: 2000, nextRateBps: null, salesToNextTier: null,
    });
  });
});

describe('approval and payouts', () => {
  const startsAt = new Date('2026-10-10T09:00:00Z');
  const booking = { cancelled: false, startsAt, checkedInAt: null };

  it('approves a sale once the ticket is scanned or the trip is 24h in the past', () => {
    const sale = { kind: 'sale' as const, status: 'pending' as const, amountMinor: 1500 };
    expect(isApprovable(sale, booking, new Date('2026-10-10T10:00:00Z'))).toBe(false);
    expect(isApprovable(sale, { ...booking, checkedInAt: startsAt }, new Date('2026-10-10T10:00:00Z'))).toBe(true);
    expect(isApprovable(sale, booking, new Date('2026-10-11T09:00:00Z'))).toBe(true);
    expect(isApprovable(sale, { ...booking, cancelled: true }, new Date('2026-10-20T00:00:00Z'))).toBe(false);
  });

  it('approves reversals immediately', () => {
    const reversal = { kind: 'reversal' as const, status: 'pending' as const, amountMinor: -1500 };
    expect(isApprovable(reversal, { ...booking, cancelled: true }, new Date('2026-10-01T00:00:00Z'))).toBe(true);
  });

  it('pays approved entries and carries forward a negative balance', () => {
    const paid = buildPayout([
      entry({ bookingId: 'b1', amountMinor: 1500, status: 'approved' }),
      entry({ bookingId: 'b2', amountMinor: 2000, status: 'approved' }),
      entry({ bookingId: 'b3', amountMinor: 2000, status: 'pending' }),
    ]);
    expect(paid).toMatchObject({ totalMinor: 3500, carryForward: false });
    expect(paid.entryIds).toHaveLength(2);

    const clawback = buildPayout([entry({ bookingId: 'b1', amountMinor: -1500, kind: 'reversal', status: 'approved' })]);
    expect(clawback).toEqual({ entryIds: [], totalMinor: -1500, carryForward: true });
  });
});
