import type { PriceDto } from '@ap/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { bookingTotals, chosenItems, defaultQuantities, ticketCount } from './booking';
import { codeState, discountErrorKey, discountText, normalizeCode } from './discounts';

const price = (id: string, amountMinor: number, kind: PriceDto['kind'] = 'ticket'): PriceDto => ({
  id,
  code: id,
  label: id[0]!.toUpperCase() + id.slice(1),
  amountMinor,
  taxRateBps: 0,
  seats: kind === 'extra' ? 0 : 1,
  kind,
  commissionable: true,
});
const prices = [price('adult', 10_000), price('child', 5000), price('lunch', 4000, 'extra')];

describe('extras in the booking form', () => {
  it('counts tickets without the extras', () => {
    expect(ticketCount({ adult: 1, lunch: 2 }, prices)).toBe(1);
    expect(ticketCount({ lunch: 2 }, prices)).toBe(0);
  });

  it('never preselects an extra, even the cheapest price', () => {
    expect(defaultQuantities([price('lunch', 20_000, 'extra'), price('child', 5000)], 10)).toEqual({
      child: 1,
    });
  });

  it('lists what was chosen', () => {
    expect(chosenItems(prices, { adult: 2, child: 0, lunch: 1 })).toBe('2 × Adult, 1 × Lunch');
  });
});

describe('discount codes', () => {
  it('shows the same total as the API will charge', () => {
    const q = { adult: 1, lunch: 1 };
    expect(bookingTotals(prices, q, null)).toEqual({
      subtotalMinor: 14_000,
      discountMinor: 0,
      totalMinor: 14_000,
    });
    expect(bookingTotals(prices, q, { percentBps: 1000, amountMinor: null })).toEqual({
      subtotalMinor: 14_000,
      discountMinor: 1400,
      totalMinor: 12_600,
    });
    // A fixed amount larger than the booking leaves 10% to pay.
    expect(bookingTotals(prices, { child: 1 }, { percentBps: null, amountMinor: 9000 })).toEqual({
      subtotalMinor: 5000,
      discountMinor: 4500,
      totalMinor: 500,
    });
  });

  it('writes the discount and the code as customers type it', () => {
    expect(discountText({ percentBps: 1000, amountMinor: null }, 'RON', 'en')).toBe('−10%');
    expect(discountText({ percentBps: null, amountMinor: 2000 }, 'EUR', 'en')).toBe('−€20');
    expect(normalizeCode(' vara 10 ')).toBe('VARA10');
  });

  it('tells a refused code apart from other errors', () => {
    const refused = new ApiError(400, 'bad request', 'x', undefined, 'errors.discounts.usedUp');
    expect(discountErrorKey(refused)).toBe('public.discount.usedUp');
    expect(
      discountErrorKey(new ApiError(400, 'bad request', 'x', undefined, 'errors.validation')),
    ).toBeNull();
    expect(discountErrorKey(new Error('x'))).toBeNull();
  });

  it('says whether a code can be used today', () => {
    const code = { active: true, validFrom: null, validUntil: null, maxUses: null, uses: 3 };
    expect(codeState(code, '2026-10-13')).toBe('active');
    expect(codeState({ ...code, active: false }, '2026-10-13')).toBe('paused');
    expect(codeState({ ...code, validFrom: '2026-10-14' }, '2026-10-13')).toBe('scheduled');
    expect(codeState({ ...code, validUntil: '2026-10-12' }, '2026-10-13')).toBe('expired');
    expect(codeState({ ...code, validUntil: '2026-10-13' }, '2026-10-13')).toBe('active');
    expect(codeState({ ...code, maxUses: 3 }, '2026-10-13')).toBe('usedUp');
  });
});
