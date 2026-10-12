import type { TierProgressDto } from '@ap/contracts';
import { formatBps } from './format';
import type { Translator } from './i18n';

export interface Tier {
  fromSale: number;
  rateBps: number;
}

/**
 * Share (0…1) of the way from the start of the current tier to the sale that reaches the next
 * one. `salesToNextTier` is `next.fromSale - paidSales` (see @ap/commission `tierProgress`).
 */
export function tierProgressFraction(progress: TierProgressDto, tiers: Tier[]): number {
  if (progress.salesToNextTier === null || progress.nextRateBps === null) return 1;
  const sorted = [...tiers].sort((a, b) => a.fromSale - b.fromSale);
  const current = sorted[progress.tierIndex];
  // Sales made before entering the current tier (0 for the first tier).
  const start = current ? Math.max(0, current.fromSale - 1) : 0;
  const target = progress.paidSales + progress.salesToNextTier;
  if (target <= start) return 0;
  return clamp((progress.paidSales - start) / (target - start));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** "2 more sales to reach 25%" / "You reached the top level: 25%" / "You earn 10% of every sale". */
export function tierProgressSentence(
  progress: TierProgressDto,
  planKind: 'fixed' | 'tiered',
  t: Translator,
): string {
  const rate = (bps: number) => formatBps(bps, t.lang);
  if (planKind === 'fixed' || progress.tierCount <= 1) {
    return t.t('labels.tier.fixed', { rate: rate(progress.currentRateBps) });
  }
  if (progress.salesToNextTier === null || progress.nextRateBps === null) {
    return t.t('labels.tier.top', { rate: rate(progress.currentRateBps) });
  }
  if (progress.salesToNextTier <= 0) {
    return t.t('labels.tier.nextSale', { rate: rate(progress.nextRateBps) });
  }
  return t.t('labels.tier.salesToNext', {
    count: progress.salesToNextTier,
    rate: rate(progress.nextRateBps),
  });
}

/** Rows for the plan explanation table: "Sales 1–5" → 10%. */
export function tierRows(tiers: Tier[], t: Translator): { label: string; rateBps: number }[] {
  const sorted = [...tiers].sort((a, b) => a.fromSale - b.fromSale);
  return sorted.map((tier, i) => {
    const next = sorted[i + 1];
    let label: string;
    if (!next)
      label =
        i === 0 ? t.t('labels.tier.allSales') : t.t('labels.tier.fromSale', { from: tier.fromSale });
    else if (next.fromSale - 1 === tier.fromSale)
      label = t.t('labels.tier.oneSale', { from: tier.fromSale });
    else label = t.t('labels.tier.salesRange', { from: tier.fromSale, to: next.fromSale - 1 });
    return { label, rateBps: tier.rateBps };
  });
}

export const planModeExplanation = (t: Translator, mode: 'marginal' | 'retroactive'): string =>
  t.tk(`labels.planMode.${mode}`);
