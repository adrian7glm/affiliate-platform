import { discountMinorFor } from '@ap/contracts';

export interface PricedLine {
  price: { amountMinor: number; taxRateBps: number; seats: number; commissionable: boolean };
  quantity: number;
}

export interface BookingAmounts {
  seats: number;
  /** Before the discount. */
  subtotalMinor: number;
  discountMinor: number;
  /** What the customer pays. */
  totalMinor: number;
  /** VAT included in the total. */
  taxMinor: number;
  /** The part of the total affiliates earn commission on, and its VAT. */
  commissionGrossMinor: number;
  commissionTaxMinor: number;
}

/** VAT included in a gross amount. */
export function includedTax(grossMinor: number, taxRateBps: number): number {
  return Math.round((grossMinor * taxRateBps) / (10_000 + taxRateBps));
}

/**
 * Splits `amount` across the weights in proportion, in whole minor units that add up exactly
 * (largest remainder first, the earlier line on a tie).
 */
export function allocate(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || amount <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (amount * w) / sum);
  const shares = exact.map(Math.floor);
  let left = amount - shares.reduce((a, s) => a + s, 0);
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

/**
 * What a booking costs. A discount is spread over its lines in proportion to their price, so
 * the VAT and the commission base shrink with it; extras without commission stay out of the base.
 */
export function priceBooking(
  lines: PricedLine[],
  code: { percentBps: number | null; amountMinor: number | null } | null,
): BookingAmounts {
  const gross = lines.map((l) => l.quantity * l.price.amountMinor);
  const subtotalMinor = gross.reduce((a, g) => a + g, 0);
  const discountMinor = code ? discountMinorFor(code, subtotalMinor) : 0;
  const shares = allocate(discountMinor, gross);
  const amounts = { taxMinor: 0, commissionGrossMinor: 0, commissionTaxMinor: 0 };
  lines.forEach((line, i) => {
    const net = gross[i]! - shares[i]!;
    const tax = includedTax(net, line.price.taxRateBps);
    amounts.taxMinor += tax;
    if (line.price.commissionable) {
      amounts.commissionGrossMinor += net;
      amounts.commissionTaxMinor += tax;
    }
  });
  return {
    seats: lines.reduce((sum, l) => sum + l.quantity * l.price.seats, 0),
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
    ...amounts,
  };
}
