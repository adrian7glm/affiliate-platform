import { percentToBps } from './format';

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
export function validateTiers(rows: TierDraft[]): TierValidation {
  const errors: Record<string, string> = {};
  const tiers: { fromSale: number; rateBps: number }[] = [];
  if (rows.length === 0) return { tiers: null, errors, general: 'Adaugă cel puțin un nivel.' };
  if (rows.length > 20) return { tiers: null, errors, general: 'Cel mult 20 de niveluri.' };

  let previous = 0;
  rows.forEach((row, index) => {
    const fromSale = index === 0 ? 1 : Number(row.fromSale);
    const rateBps = percentToBps(row.percent);
    if (!Number.isInteger(fromSale) || fromSale < 1) {
      errors[row.key] = 'Scrie numărul vânzării (1, 2, 3…).';
    } else if (fromSale <= previous) {
      errors[row.key] = `Trebuie să fie mai mare decât ${previous}.`;
    } else if (rateBps === null) {
      errors[row.key] = 'Scrie un procent între 0 și 100.';
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
