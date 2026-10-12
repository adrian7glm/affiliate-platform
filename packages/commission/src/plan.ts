import { assertRateBps } from './money';

/**
 * What the commission percentage is applied to.
 * - `gross`: the full price the customer paid, VAT included.
 * - `net_of_tax`: the price without VAT.
 */
export type CommissionBasis = 'gross' | 'net_of_tax';

/**
 * A progressive tier. `fromSale` is the 1-based number of the first sale in the period that
 * earns `rateBps`; the tier lasts until the next tier's `fromSale`.
 * Example: [{fromSale: 1, rateBps: 1500}, {fromSale: 4, rateBps: 2000}, {fromSale: 11, rateBps: 2500}]
 * means sales 1-3 earn 15%, sales 4-10 earn 20%, sales 11+ earn 25%.
 */
export interface Tier {
  fromSale: number;
  rateBps: number;
}

/**
 * - `marginal`: each sale earns the rate of the tier it falls in (sale #5 earns 20% even after
 *   the affiliate reaches 25%). The commission is known at the moment of sale.
 * - `retroactive`: once a tier is reached, every sale in the period earns that tier's rate.
 *   Earlier sales are uplifted with adjustment entries when the period closes.
 */
export type TierMode = 'marginal' | 'retroactive';

export interface FixedPlan {
  kind: 'fixed';
  rateBps: number;
  basis: CommissionBasis;
}

export interface TieredPlan {
  kind: 'tiered';
  mode: TierMode;
  tiers: Tier[];
  basis: CommissionBasis;
}

export type CommissionPlan = FixedPlan | TieredPlan;

export class CommissionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommissionPlanError';
  }
}

export function validatePlan(plan: CommissionPlan): CommissionPlan {
  if (plan.basis !== 'gross' && plan.basis !== 'net_of_tax') {
    throw new CommissionPlanError(`unknown basis "${String(plan.basis)}"`);
  }
  if (plan.kind === 'fixed') {
    assertRateBps(plan.rateBps);
    return plan;
  }
  if (plan.kind !== 'tiered') {
    throw new CommissionPlanError(`unknown plan kind "${String((plan as { kind: unknown }).kind)}"`);
  }
  if (plan.mode !== 'marginal' && plan.mode !== 'retroactive') {
    throw new CommissionPlanError(`unknown tier mode "${String(plan.mode)}"`);
  }
  if (plan.tiers.length === 0) {
    throw new CommissionPlanError('a tiered plan needs at least one tier');
  }
  plan.tiers.forEach((tier, index) => {
    if (!Number.isInteger(tier.fromSale) || tier.fromSale < 1) {
      throw new CommissionPlanError(`tier ${index + 1}: fromSale must be an integer >= 1`);
    }
    assertRateBps(tier.rateBps, `tier ${index + 1} rateBps`);
    if (index === 0 && tier.fromSale !== 1) {
      throw new CommissionPlanError('the first tier must start at sale 1');
    }
    const previous = plan.tiers[index - 1];
    if (previous && tier.fromSale <= previous.fromSale) {
      throw new CommissionPlanError('tiers must be sorted by fromSale, strictly increasing');
    }
  });
  return plan;
}

/**
 * The plan that actually applies to an affiliate: a negotiated per-affiliate rate overrides the
 * operator's default plan with a fixed rate on the same basis.
 */
export function effectivePlan(plan: CommissionPlan, overrideRateBps?: number | null): CommissionPlan {
  if (overrideRateBps === undefined || overrideRateBps === null) {
    return validatePlan(plan);
  }
  assertRateBps(overrideRateBps, 'overrideRateBps');
  return { kind: 'fixed', rateBps: overrideRateBps, basis: plan.basis };
}

/** Index of the tier a given 1-based sale number falls into. */
export function tierIndexForSale(plan: TieredPlan, saleNumber: number): number {
  if (!Number.isInteger(saleNumber) || saleNumber < 1) {
    throw new RangeError(`saleNumber must be an integer >= 1, got ${saleNumber}`);
  }
  let index = 0;
  plan.tiers.forEach((tier, i) => {
    if (saleNumber >= tier.fromSale) index = i;
  });
  return index;
}

/** The rate earned by the n-th paid sale of the period (1-based). */
export function rateForSale(plan: CommissionPlan, saleNumber: number): number {
  if (plan.kind === 'fixed') return plan.rateBps;
  const tier = plan.tiers[tierIndexForSale(plan, saleNumber)];
  if (!tier) throw new CommissionPlanError('plan has no tiers');
  return tier.rateBps;
}
