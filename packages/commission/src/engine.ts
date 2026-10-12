import { applyRate, assertMinorUnits } from './money';
import { type CommissionPlan, rateForSale, tierIndexForSale, validatePlan } from './plan';

/**
 * A booking attributed to an affiliate, as the commission engine sees it.
 * A "sale" (for tier counting) is a paid booking that has not been cancelled or refunded,
 * counted in the period in which it was paid.
 */
export interface Sale {
  bookingId: string;
  paidAt: Date;
  grossMinor: number;
  taxMinor: number;
  cancelled: boolean;
}

export interface SaleCommission {
  bookingId: string;
  /** 1-based position of the sale among the period's paid sales; null when cancelled. */
  saleNumber: number | null;
  baseMinor: number;
  rateBps: number;
  amountMinor: number;
}

export function commissionBase(plan: CommissionPlan, sale: Pick<Sale, 'grossMinor' | 'taxMinor'>): number {
  assertMinorUnits(sale.grossMinor, 'grossMinor');
  assertMinorUnits(sale.taxMinor, 'taxMinor');
  if (sale.grossMinor < 0 || sale.taxMinor < 0 || sale.taxMinor > sale.grossMinor) {
    throw new RangeError('grossMinor and taxMinor must be >= 0 and tax cannot exceed gross');
  }
  return plan.basis === 'gross' ? sale.grossMinor : sale.grossMinor - sale.taxMinor;
}

/**
 * Commission for a sale at the moment it is paid, given how many paid sales the affiliate
 * already has in the same period. This is what gets written to the ledger immediately.
 * For retroactive plans it is provisional: the period close may add an uplift.
 */
export function commissionAtSale(
  plan: CommissionPlan,
  sale: Pick<Sale, 'bookingId' | 'grossMinor' | 'taxMinor'>,
  paidSalesBefore: number,
): SaleCommission {
  validatePlan(plan);
  if (!Number.isInteger(paidSalesBefore) || paidSalesBefore < 0) {
    throw new RangeError('paidSalesBefore must be an integer >= 0');
  }
  const saleNumber = paidSalesBefore + 1;
  const baseMinor = commissionBase(plan, sale);
  const rateBps = rateForSale(plan, saleNumber);
  return {
    bookingId: sale.bookingId,
    saleNumber,
    baseMinor,
    rateBps,
    amountMinor: applyRate(baseMinor, rateBps),
  };
}

function bySaleOrder(a: Sale, b: Sale): number {
  const diff = a.paidAt.getTime() - b.paidAt.getTime();
  if (diff !== 0) return diff;
  return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
}

/**
 * What every sale of one affiliate in one period should finally earn, given all the sales of
 * that period. Sales are ordered by payment time (booking id breaks ties) so the result is
 * deterministic. Cancelled sales earn nothing and do not count towards tiers.
 */
export function computePeriodCommissions(plan: CommissionPlan, sales: Sale[]): SaleCommission[] {
  validatePlan(plan);
  const ordered = [...sales].sort(bySaleOrder);
  const paidCount = ordered.filter((sale) => !sale.cancelled).length;
  const retroactiveRate =
    plan.kind === 'tiered' && plan.mode === 'retroactive' && paidCount > 0
      ? rateForSale(plan, paidCount)
      : null;

  let saleNumber = 0;
  return ordered.map((sale) => {
    const baseMinor = commissionBase(plan, sale);
    if (sale.cancelled) {
      return { bookingId: sale.bookingId, saleNumber: null, baseMinor, rateBps: 0, amountMinor: 0 };
    }
    saleNumber += 1;
    const rateBps = retroactiveRate ?? rateForSale(plan, saleNumber);
    return {
      bookingId: sale.bookingId,
      saleNumber,
      baseMinor,
      rateBps,
      amountMinor: applyRate(baseMinor, rateBps),
    };
  });
}

export interface TierProgress {
  paidSales: number;
  /** Index of the tier reached with the sales made so far (0 before the first sale). */
  tierIndex: number;
  tierCount: number;
  /** Rate of the tier reached so far. */
  currentRateBps: number;
  /** Rate the affiliate's next sale will earn. */
  nextSaleRateBps: number;
  /** Rate of the next tier; null on a fixed plan or in the top tier. */
  nextRateBps: number | null;
  /** Additional sales needed to reach the next tier; null when there is none. */
  salesToNextTier: number | null;
}

/** What the affiliate sees on their home screen: "2 more sales to reach 25%". */
export function tierProgress(plan: CommissionPlan, paidSales: number): TierProgress {
  validatePlan(plan);
  if (!Number.isInteger(paidSales) || paidSales < 0) {
    throw new RangeError('paidSales must be an integer >= 0');
  }
  if (plan.kind === 'fixed') {
    return {
      paidSales,
      tierIndex: 0,
      tierCount: 1,
      currentRateBps: plan.rateBps,
      nextSaleRateBps: plan.rateBps,
      nextRateBps: null,
      salesToNextTier: null,
    };
  }
  const tierIndex = paidSales === 0 ? 0 : tierIndexForSale(plan, paidSales);
  const current = plan.tiers[tierIndex];
  const next = plan.tiers[tierIndex + 1];
  if (!current) throw new Error('unreachable: tier index out of range');
  return {
    paidSales,
    tierIndex,
    tierCount: plan.tiers.length,
    currentRateBps: current.rateBps,
    nextSaleRateBps: rateForSale(plan, paidSales + 1),
    nextRateBps: next ? next.rateBps : null,
    salesToNextTier: next ? next.fromSale - paidSales : null,
  };
}
