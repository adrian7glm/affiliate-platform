import type { TierProgressDto } from '@ap/contracts';
import { describe, expect, it } from 'vitest';
import { tierProgressFraction, tierProgressSentence, tierRows } from './commission';

const tiers = [
  { fromSale: 1, rateBps: 1000 },
  { fromSale: 6, rateBps: 1500 },
  { fromSale: 11, rateBps: 2500 },
];

function progress(partial: Partial<TierProgressDto>): TierProgressDto {
  return {
    paidSales: 0,
    tierIndex: 0,
    tierCount: 3,
    currentRateBps: 1000,
    nextSaleRateBps: 1000,
    nextRateBps: 1500,
    salesToNextTier: 6,
    ...partial,
  };
}

const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('tierProgressSentence', () => {
  it('counts the sales left to the next tier', () => {
    expect(
      plain(
        tierProgressSentence(
          progress({ paidSales: 9, tierIndex: 1, salesToNextTier: 2, nextRateBps: 2500 }),
          'tiered',
        ),
      ),
    ).toBe('Încă 2 vânzări până la 25 %');
  });

  it('says "o vânzare" for one sale', () => {
    expect(
      plain(tierProgressSentence(progress({ paidSales: 5, salesToNextTier: 1 }), 'tiered')),
    ).toBe('Încă o vânzare până la 15 %');
  });

  it('handles the top tier and fixed plans', () => {
    expect(
      plain(
        tierProgressSentence(
          progress({
            tierIndex: 2,
            currentRateBps: 2500,
            nextRateBps: null,
            salesToNextTier: null,
          }),
          'tiered',
        ),
      ),
    ).toBe('Ai atins nivelul maxim: 25 % din fiecare vânzare.');
    expect(plain(tierProgressSentence(progress({ tierCount: 1 }), 'fixed'))).toBe(
      'Câștigi 10 % din fiecare vânzare.',
    );
  });
});

describe('tierProgressFraction', () => {
  it('measures progress inside the current tier', () => {
    // Tier 2 starts after sale 5, the next tier at sale 11: 8 paid sales → 3 of 6.
    expect(
      tierProgressFraction(progress({ paidSales: 8, tierIndex: 1, salesToNextTier: 3 }), tiers),
    ).toBeCloseTo(0.5);
  });

  it('is full at the top tier', () => {
    expect(
      tierProgressFraction(progress({ nextRateBps: null, salesToNextTier: null }), tiers),
    ).toBe(1);
  });

  it('starts empty', () => {
    expect(tierProgressFraction(progress({ paidSales: 0, salesToNextTier: 6 }), tiers)).toBe(0);
  });
});

describe('tierRows', () => {
  it('labels sale ranges', () => {
    expect(tierRows(tiers).map((r) => r.label)).toEqual([
      'Vânzările 1–5',
      'Vânzările 6–10',
      'De la vânzarea 11',
    ]);
    expect(tierRows([{ fromSale: 1, rateBps: 1000 }])[0]?.label).toBe('Toate vânzările');
    expect(
      tierRows([
        { fromSale: 1, rateBps: 1000 },
        { fromSale: 2, rateBps: 2000 },
      ])[0]?.label,
    ).toBe('Vânzarea 1');
  });
});
