import { percentToBps } from './format';
import type { Translator } from './i18n';

export interface TierDraft {
  key: string;
  fromSale: string;
  percent: string;
}

export interface TierValidation {
  tiers: { fromSale: number; rateBps: number }[] | null;
  /** Error per row key, plus a general error. */
  errors: Record<string, string>;
  general?: string;
}

/**
 * Validates the tier editor rows: the first tier starts at sale 1, thresholds strictly increase,
 * percentages are 0–100 (converted to basis points).
 */
export function validateTiers(rows: TierDraft[], t: Translator): TierValidation {
  const errors: Record<string, string> = {};
  const tiers: { fromSale: number; rateBps: number }[] = [];
  if (rows.length === 0) return { tiers: null, errors, general: t.t('labels.tierEditor.atLeastOne') };
  if (rows.length > 20) return { tiers: null, errors, general: t.t('labels.tierEditor.atMost', { count: 20 }) };

  let previous = 0;
  rows.forEach((row, index) => {
    const fromSale = index === 0 ? 1 : Number(row.fromSale);
    const rateBps = percentToBps(row.percent);
    if (!Number.isInteger(fromSale) || fromSale < 1) {
      errors[row.key] = t.t('labels.tierEditor.saleNumber');
    } else if (fromSale <= previous) {
      errors[row.key] = t.t('labels.tierEditor.greaterThan', { previous });
    } else if (rateBps === null) {
      errors[row.key] = t.t('labels.tierEditor.percent');
    } else {
      tiers.push({ fromSale, rateBps });
    }
    if (Number.isInteger(fromSale)) previous = Math.max(previous, fromSale);
  });

  return Object.keys(errors).length > 0 ? { tiers: null, errors } : { tiers, errors };
}

let counter = 0;
export function newTierRow(fromSale: number, percent: string): TierDraft {
  counter += 1;
  return { key: `tier-${counter}`, fromSale: String(fromSale), percent };
}
