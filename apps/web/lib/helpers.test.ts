import type { PriceDto, SlotDto } from '@ap/contracts';
import { describe, expect, it } from 'vitest';
import { looksLikeToken } from '@/components/scanner/qrDecoder';
import { qrPath } from '@/components/QrCode';
import {
  defaultQuantities,
  groupSlotsByDay,
  maxQuantityFor,
  seatsNeeded,
  ticketCount,
  toItems,
  totalMinor,
  upcomingSlots,
} from './booking';
import { isValidEmail, isValidPhone, maskDestination, normalizePhone } from './contact';
import { addDays, dateKeyInTz, isoWeekday, nextDays, shiftPeriod } from './dates';
import { parseHex, parseTicketUrl, readableTextOn, ticketPath } from './links';
import { validateTiers } from './plans';
import { pickMembership, safeNextPath } from './session';

const prices: PriceDto[] = [
  { id: 'adult', code: 'adult', label: 'Adult', amountMinor: 10000, taxRateBps: 900, seats: 1 },
  { id: 'child', code: 'child', label: 'Copil', amountMinor: 5000, taxRateBps: 900, seats: 1 },
  { id: 'infant', code: 'infant', label: 'Bebeluș', amountMinor: 0, taxRateBps: 0, seats: 0 },
];

describe('booking math', () => {
  it('totals amounts and seats', () => {
    const q = { adult: 2, child: 1, infant: 1 };
    expect(totalMinor(prices, q)).toBe(25000);
    expect(seatsNeeded(prices, q)).toBe(3);
    expect(ticketCount(q)).toBe(4);
    expect(toItems({ adult: 2, child: 0 })).toEqual([{ priceId: 'adult', quantity: 2 }]);
  });

  it('caps quantities by the seats left', () => {
    expect(maxQuantityFor(prices[0]!, prices, { adult: 1, child: 2 }, 4)).toBe(2);
    // Lap infants take no seat.
    expect(maxQuantityFor(prices[2]!, prices, { adult: 4 }, 4)).toBe(50);
    expect(defaultQuantities(prices, 0)).toEqual({});
    expect(defaultQuantities(prices, 5)).toEqual({ adult: 1 });
    // Cheapest first, no `adult` code: still defaults to the full-price ticket.
    const reordered = [...prices].reverse().map((p) => ({ ...p, code: `x-${p.code}` }));
    expect(defaultQuantities(reordered, 5)).toEqual({ adult: 1 });
  });

  it('groups departures by local day and hides past ones', () => {
    const slots: SlotDto[] = [
      {
        id: 'b',
        startsAt: '2026-07-01T14:00:00Z',
        endsAt: '2026-07-01T16:00:00Z',
        capacity: 10,
        available: 3,
      },
      {
        id: 'a',
        startsAt: '2026-07-01T06:00:00Z',
        endsAt: '2026-07-01T08:00:00Z',
        capacity: 10,
        available: 0,
      },
      // 22:30 UTC is already 1 July in Bucharest (UTC+3).
      {
        id: 'c',
        startsAt: '2026-06-30T22:30:00Z',
        endsAt: '2026-07-01T00:30:00Z',
        capacity: 10,
        available: 9,
      },
    ];
    const byDay = groupSlotsByDay(slots, 'Europe/Bucharest');
    expect([...byDay.keys()]).toEqual(['2026-07-01']);
    expect(byDay.get('2026-07-01')!.map((s) => s.id)).toEqual(['c', 'a', 'b']);
    expect(upcomingSlots(slots, new Date('2026-07-01T10:00:00Z')).map((s) => s.id)).toEqual(['b']);
  });
});

describe('dates', () => {
  it('does calendar arithmetic in the tenant timezone', () => {
    expect(dateKeyInTz('2026-03-28T23:30:00Z', 'Europe/Bucharest')).toBe('2026-03-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoWeekday('2026-10-12')).toBe(1);
    expect(nextDays(3, 'UTC', new Date('2026-10-12T12:00:00Z'))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });
});

describe('contact', () => {
  it('normalizes Romanian and international phone numbers', () => {
    expect(normalizePhone('0722 123 456')).toBe('+40722123456');
    expect(normalizePhone('0044 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('+49 (151) 234-5678')).toBe('+491512345678');
    expect(isValidPhone('+40722123456')).toBe(true);
    expect(isValidPhone('0722123456')).toBe(false);
    expect(isValidEmail('ana@example.ro')).toBe(true);
    expect(isValidEmail('ana@')).toBe(false);
    expect(maskDestination('+40722123456')).not.toContain('123');
  });
});

describe('links', () => {
  it('parses ticket URLs from the API', () => {
    expect(parseTicketUrl('https://app.test/t/abc-123?k=KEY_1')).toEqual({
      bookingId: 'abc-123',
      key: 'KEY_1',
    });
    expect(parseTicketUrl('https://app.test/b/x')).toBeNull();
    expect(ticketPath('abc', 'k1', 'ro')).toBe('/t/abc?k=k1&lang=ro');
  });

  it('picks readable text on brand colors', () => {
    expect(readableTextOn('#0369a1')).toBe('#ffffff');
    expect(readableTextOn('#fde047')).toBe('#000000');
    expect(parseHex('#abc')).toEqual([170, 187, 204]);
    expect(parseHex('blue')).toBeNull();
  });
});

describe('validateTiers', () => {
  it('accepts increasing thresholds and forces the first tier to sale 1', () => {
    const result = validateTiers([
      { key: 'a', fromSale: '3', percent: '10' },
      { key: 'b', fromSale: '6', percent: '12,5' },
    ]);
    expect(result.tiers).toEqual([
      { fromSale: 1, rateBps: 1000 },
      { fromSale: 6, rateBps: 1250 },
    ]);
  });

  it('flags thresholds that do not increase and bad percentages', () => {
    const result = validateTiers([
      { key: 'a', fromSale: '1', percent: '10' },
      { key: 'b', fromSale: '1', percent: '15' },
      { key: 'c', fromSale: '8', percent: 'x' },
    ]);
    expect(result.tiers).toBeNull();
    expect(Object.keys(result.errors)).toEqual(['b', 'c']);
  });
});

describe('session helpers', () => {
  const memberships = [
    {
      tenantId: 't1',
      tenantName: 'Delta',
      tenantSlug: 'delta',
      role: 'affiliate' as const,
      affiliateId: 'a1',
    },
    {
      tenantId: 't2',
      tenantName: 'Mare',
      tenantSlug: 'mare',
      role: 'owner' as const,
      affiliateId: null,
    },
  ];

  it('picks the membership for an area', () => {
    expect(pickMembership(memberships, 'operator', null)?.tenantId).toBe('t2');
    expect(pickMembership(memberships, 'affiliate', 't2')?.tenantId).toBe('t1');
  });

  it('only follows local next paths', () => {
    expect(safeNextPath('/a/qr')).toBe('/a/qr');
    expect(safeNextPath('//evil.test')).toBeNull();
    expect(safeNextPath('https://evil.test')).toBeNull();
  });
});

describe('scanner and QR', () => {
  it('recognizes ticket tokens', () => {
    expect(looksLikeToken('eyJhbGciOi.payload.signature')).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    expect(looksLikeToken('has a space in it here')).toBe(false);
  });

  it('draws a square QR path', () => {
    const { path, size } = qrPath('https://app.test/r/ANA1?s=qr');
    expect(size).toBeGreaterThanOrEqual(21);
    expect(path.startsWith('M')).toBe(true);
  });
});
