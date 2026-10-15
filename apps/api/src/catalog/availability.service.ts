import { HttpStatus, Injectable } from '@nestjs/common';
import { holds, slots } from '@ap/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DomainError, NotFound } from '../common/errors';
import type { DbOrTx } from '../database/database.module';

export type Slot = typeof slots.$inferSelect;

/**
 * Seats of a departure. For the internal calendar seats are reserved with a single conditional
 * UPDATE, so two receptionists booking the last seats at the same time can never oversell it.
 * For trips imported from the operator's own system the seats are held there first (see
 * SourcesService) and the local counters are only a cache of their availability.
 */
@Injectable()
export class AvailabilityService {
  async slot(db: DbOrTx, tenantId: string, slotId: string): Promise<Slot> {
    const [slot] = await db
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.tenantId, tenantId)));
    if (!slot) throw new NotFound('departure');
    return slot;
  }

  assertBookable(slot: Slot, now: Date): void {
    if (slot.closed || slot.startsAt <= now) {
      throw new DomainError('errors.departures.closed', HttpStatus.CONFLICT);
    }
  }

  /**
   * Reserves seats and records a hold that expires if the customer does not pay. With an
   * `externalHoldId` the seats are already held in the operator's system.
   */
  async hold(
    db: DbOrTx,
    slot: Slot,
    seats: number,
    expiresAt: Date,
    now: Date,
    externalHoldId: string | null = null,
  ): Promise<string> {
    this.assertBookable(slot, now);
    if (externalHoldId) {
      await this.reserveCached(db, slot.id, seats);
      return this.insertHold(db, slot, seats, expiresAt, externalHoldId);
    }
    const reserved = await db
      .update(slots)
      .set({ reserved: sql`${slots.reserved} + ${seats}` })
      .where(and(eq(slots.id, slot.id), sql`${slots.capacity} - ${slots.reserved} >= ${seats}`))
      .returning({ id: slots.id });
    if (reserved.length === 0) {
      const [current] = await db
        .select({ capacity: slots.capacity, reserved: slots.reserved })
        .from(slots)
        .where(eq(slots.id, slot.id));
      const left = current ? Math.max(0, current.capacity - current.reserved) : 0;
      throw new DomainError(
        'errors.departures.seatsLeft',
        HttpStatus.CONFLICT,
        { available: left },
        { count: left },
      );
    }
    return this.insertHold(db, slot, seats, expiresAt, null);
  }

  private async insertHold(
    db: DbOrTx,
    slot: Slot,
    seats: number,
    expiresAt: Date,
    externalHoldId: string | null,
  ): Promise<string> {
    const [hold] = await db
      .insert(holds)
      .values({ tenantId: slot.tenantId, slotId: slot.id, seats, expiresAt, externalHoldId })
      .returning({ id: holds.id });
    return hold!.id;
  }

  /** Counts seats taken in an external system in the local cache, without checking capacity. */
  async reserveCached(db: DbOrTx, slotId: string, seats: number): Promise<void> {
    await db
      .update(slots)
      .set({ reserved: sql`least(${slots.reserved} + ${seats}, ${slots.capacity})` })
      .where(eq(slots.id, slotId));
  }

  /**
   * Re-reserves seats for a payment that arrived after its hold expired. Returns false if the
   * seats were sold meanwhile, or the departure was called off or has already left.
   */
  async reserveLate(db: DbOrTx, slotId: string, seats: number, now: Date): Promise<boolean> {
    const rows = await db
      .update(slots)
      .set({ reserved: sql`${slots.reserved} + ${seats}` })
      .where(
        and(
          eq(slots.id, slotId),
          eq(slots.closed, false),
          gt(slots.startsAt, now),
          sql`${slots.capacity} - ${slots.reserved} >= ${seats}`,
        ),
      )
      .returning({ id: slots.id });
    return rows.length > 0;
  }

  async confirmHold(db: DbOrTx, holdId: string, now: Date): Promise<boolean> {
    const rows = await db
      .update(holds)
      .set({ confirmedAt: now })
      .where(and(eq(holds.id, holdId), isNull(holds.releasedAt), isNull(holds.confirmedAt)))
      .returning({ id: holds.id });
    return rows.length > 0;
  }

  /**
   * Frees the seats of an unpaid hold. Idempotent. Returns the operator system's hold id when the
   * seats were also held there, so the caller can release it once its transaction committed.
   */
  async releaseHold(db: DbOrTx, holdId: string, now: Date): Promise<string | null> {
    const [hold] = await db
      .update(holds)
      .set({ releasedAt: now })
      .where(and(eq(holds.id, holdId), isNull(holds.releasedAt), isNull(holds.confirmedAt)))
      .returning();
    if (!hold) return null;
    await this.freeSeats(db, hold.slotId, hold.seats);
    return hold.externalHoldId;
  }

  /** Frees the seats of a confirmed booking that was cancelled. */
  async freeSeats(db: DbOrTx, slotId: string, seats: number): Promise<void> {
    await db
      .update(slots)
      .set({ reserved: sql`greatest(${slots.reserved} - ${seats}, 0)` })
      .where(eq(slots.id, slotId));
  }

  async isHoldActive(db: DbOrTx, holdId: string, now: Date): Promise<boolean> {
    const [hold] = await db
      .select({ id: holds.id })
      .from(holds)
      .where(and(eq(holds.id, holdId), isNull(holds.releasedAt), gt(holds.expiresAt, now)));
    return Boolean(hold);
  }
}
