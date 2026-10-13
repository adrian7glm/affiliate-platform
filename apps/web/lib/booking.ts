import type { PriceDto, SlotDto } from '@ap/contracts';
import { dateKeyInTz } from './dates';

export type Quantities = Record<string, number>;

/** Departures grouped by local calendar day, each day sorted by time. */
export function groupSlotsByDay<T extends SlotDto>(
  slots: T[],
  tz?: string | null,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const slot of [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = dateKeyInTz(slot.startsAt, tz);
    const list = byDay.get(key);
    if (list) list.push(slot);
    else byDay.set(key, [slot]);
  }
  return byDay;
}

/** Hides departures that already left. */
export function upcomingSlots(slots: SlotDto[], now: Date = new Date()): SlotDto[] {
  return slots.filter((s) => new Date(s.startsAt).getTime() > now.getTime());
}

export function totalMinor(prices: PriceDto[], quantities: Quantities): number {
  return prices.reduce((sum, p) => sum + p.amountMinor * (quantities[p.id] ?? 0), 0);
}

export function seatsNeeded(prices: PriceDto[], quantities: Quantities): number {
  return prices.reduce((sum, p) => sum + p.seats * (quantities[p.id] ?? 0), 0);
}

export function ticketCount(quantities: Quantities): number {
  return Object.values(quantities).reduce((sum, q) => sum + q, 0);
}

/** Items for the booking request (only chosen prices). */
export function toItems(quantities: Quantities): { priceId: string; quantity: number }[] {
  return Object.entries(quantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([priceId, quantity]) => ({ priceId, quantity }));
}

/** Highest quantity still allowed for one price, given the seats left on the departure. */
export function maxQuantityFor(
  price: PriceDto,
  prices: PriceDto[],
  quantities: Quantities,
  available: number,
): number {
  const current = quantities[price.id] ?? 0;
  if (price.seats === 0) return 50;
  const usedByOthers = seatsNeeded(prices, quantities) - price.seats * current;
  const room = Math.floor((available - usedByOthers) / price.seats);
  return Math.max(current, Math.min(50, room));
}

/**
 * Default selection: one standard ticket, if it fits. That is the `adult` price when there is
 * one, otherwise the most expensive ticket that takes a seat (never a child or infant ticket).
 */
export function defaultQuantities(prices: PriceDto[], available: number): Quantities {
  const seated = prices.filter((p) => p.seats > 0);
  const standard =
    seated.find((p) => p.code === 'adult') ??
    [...seated].sort((a, b) => b.amountMinor - a.amountMinor)[0];
  if (!standard || standard.seats > available) return {};
  return { [standard.id]: 1 };
}
