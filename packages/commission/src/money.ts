/**
 * Money is always handled as integer minor units (bani, cents) to avoid floating point errors.
 * Rates are expressed in basis points: 10000 bps = 100%, 2000 bps = 20%.
 */

export const BPS_SCALE = 10_000;

export function assertMinorUnits(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer of minor units, got ${value}`);
  }
}

export function assertRateBps(rateBps: number, label = 'rateBps'): void {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > BPS_SCALE) {
    throw new RangeError(`${label} must be an integer between 0 and ${BPS_SCALE}, got ${rateBps}`);
  }
}

/**
 * Applies a rate to an amount, rounding half away from zero to the nearest minor unit.
 * Negative amounts (reversals) round symmetrically to their positive counterpart.
 */
export function applyRate(amountMinor: number, rateBps: number): number {
  assertMinorUnits(amountMinor);
  assertRateBps(rateBps);
  const sign = amountMinor < 0 ? -1 : 1;
  const product = Math.abs(amountMinor) * rateBps;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`amount ${amountMinor} is too large to apply a rate safely`);
  }
  const rounded = Math.floor((product + BPS_SCALE / 2) / BPS_SCALE);
  return rounded === 0 ? 0 : sign * rounded;
}

/** Converts a percentage such as 15 or 12.5 into basis points. */
export function percentToBps(percent: number): number {
  const bps = Math.round(percent * 100);
  assertRateBps(bps, 'percent');
  return bps;
}

export function bpsToPercent(rateBps: number): number {
  assertRateBps(rateBps);
  return rateBps / 100;
}
