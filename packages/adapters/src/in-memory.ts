import { randomUUID } from 'node:crypto';
import {
  type AvailabilityProvider,
  type ConfirmRequest,
  type HoldRequest,
  type HoldResult,
  HoldExpiredError,
  type ProviderProduct,
  type ProviderSlot,
  SoldOutError,
} from './provider';

interface MemorySlot extends ProviderSlot {
  productExternalId: string;
  externalId: string;
}

interface MemoryHold {
  slotId: string;
  seats: number;
  expiresAt: Date;
  confirmedRef: string | null;
}

/**
 * Reference implementation of the provider contract, kept in memory.
 * Used in tests and as a fake operator system in local development.
 */
export class InMemoryProvider implements AvailabilityProvider {
  readonly kind = 'in_memory';
  private readonly slots = new Map<string, MemorySlot>();
  private readonly holds = new Map<string, MemoryHold>();
  private readonly bookings = new Map<string, string>();

  constructor(
    private readonly products: ProviderProduct[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {}

  addSlot(productExternalId: string, startsAt: Date, durationMinutes: number, capacity: number): string {
    const externalId = randomUUID();
    this.slots.set(externalId, {
      externalId,
      productExternalId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
      capacity,
      available: capacity,
    });
    return externalId;
  }

  async listProducts(): Promise<ProviderProduct[]> {
    return this.products;
  }

  async getAvailability(productExternalId: string, from: Date, to: Date): Promise<ProviderSlot[]> {
    this.expireHolds();
    return [...this.slots.values()]
      .filter((s) => s.productExternalId === productExternalId && s.startsAt >= from && s.startsAt < to)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map(({ externalId, startsAt, endsAt, capacity, available }) => ({
        externalId,
        startsAt,
        endsAt,
        capacity,
        available,
      }));
  }

  async hold(request: HoldRequest): Promise<HoldResult> {
    this.expireHolds();
    const slot = this.findSlot(request);
    if (!slot || slot.available < request.seats) throw new SoldOutError(slot?.available ?? 0);
    slot.available -= request.seats;
    const holdId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + request.ttlSeconds * 1000);
    this.holds.set(holdId, { slotId: slot.externalId, seats: request.seats, expiresAt, confirmedRef: null });
    return { holdId, expiresAt };
  }

  async confirm(request: ConfirmRequest): Promise<{ externalRef: string }> {
    this.expireHolds();
    const hold = this.holds.get(request.holdId);
    if (!hold) throw new HoldExpiredError(request.holdId);
    if (!hold.confirmedRef) {
      hold.confirmedRef = `MEM-${request.reference}`;
      this.bookings.set(hold.confirmedRef, request.holdId);
    }
    return { externalRef: hold.confirmedRef };
  }

  async release(holdId: string): Promise<void> {
    const hold = this.holds.get(holdId);
    if (!hold || hold.confirmedRef) return;
    this.freeSeats(hold);
    this.holds.delete(holdId);
  }

  async cancel(externalRef: string): Promise<void> {
    const holdId = this.bookings.get(externalRef);
    if (!holdId) return;
    const hold = this.holds.get(holdId);
    if (hold) this.freeSeats(hold);
    this.holds.delete(holdId);
    this.bookings.delete(externalRef);
  }

  private findSlot(request: HoldRequest): MemorySlot | undefined {
    if (request.slotExternalId) return this.slots.get(request.slotExternalId);
    return [...this.slots.values()].find(
      (s) =>
        s.productExternalId === request.productExternalId &&
        s.startsAt.getTime() === request.startsAt.getTime(),
    );
  }

  private freeSeats(hold: MemoryHold): void {
    const slot = this.slots.get(hold.slotId);
    if (slot) slot.available += hold.seats;
  }

  private expireHolds(): void {
    const now = this.now().getTime();
    for (const [id, hold] of this.holds) {
      if (!hold.confirmedRef && hold.expiresAt.getTime() <= now) {
        this.freeSeats(hold);
        this.holds.delete(id);
      }
    }
  }
}
