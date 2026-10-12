import type { TierProgressDto } from '@ap/contracts';
import { formatBps } from './format';
import { pluralRo } from './i18n';

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

/** "Încă 2 vânzări până la 25%" / "Ai atins nivelul maxim: 25%" / "Câștigi 10% din fiecare vânzare". */
export function tierProgressSentence(
  progress: TierProgressDto,
  planKind: 'fixed' | 'tiered',
): string {
  if (planKind === 'fixed' || progress.tierCount <= 1) {
    return `Câștigi ${formatBps(progress.currentRateBps)} din fiecare vânzare.`;
  }
  if (progress.salesToNextTier === null || progress.nextRateBps === null) {
    return `Ai atins nivelul maxim: ${formatBps(progress.currentRateBps)} din fiecare vânzare.`;
  }
  if (progress.salesToNextTier <= 0) {
    return `Următoarea vânzare intră la ${formatBps(progress.nextRateBps)}.`;
  }
  const sales =
    progress.salesToNextTier === 1
      ? 'o vânzare'
      : pluralRo(progress.salesToNextTier, 'vânzare', 'vânzări');
  return `Încă ${sales} până la ${formatBps(progress.nextRateBps)}`;
}

/** Rows for the plan explanation table: "Vânzările 1–5" → 10%. */
export function tierRows(tiers: Tier[]): { label: string; rateBps: number }[] {
  const sorted = [...tiers].sort((a, b) => a.fromSale - b.fromSale);
  return sorted.map((tier, i) => {
    const next = sorted[i + 1];
    let label: string;
    if (!next) label = i === 0 ? 'Toate vânzările' : `De la vânzarea ${tier.fromSale}`;
    else if (next.fromSale - 1 === tier.fromSale) label = `Vânzarea ${tier.fromSale}`;
    else label = `Vânzările ${tier.fromSale}–${next.fromSale - 1}`;
    return { label, rateBps: tier.rateBps };
  });
}

export const PLAN_MODE_EXPLANATION: Record<'marginal' | 'retroactive', string> = {
  marginal:
    'Fiecare vânzare primește procentul nivelului în care intră. Numărătoarea începe de la zero în fiecare lună.',
  retroactive:
    'Când treci într-un nivel nou, procentul nou se aplică tuturor vânzărilor din luna respectivă. Numărătoarea începe de la zero în fiecare lună.',
};
