import { HttpStatus, Injectable } from '@nestjs/common';
import { holds, slots } from '@ap/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DomainError } from '../common/errors';
import type { DbOrTx } from '../database/database.module';

export type Slot = typeof slots.$inferSelect;

/**
 * Seats for the internal calendar. Seats are reserved with a single conditional UPDATE, so two
 * receptionists booking the last seats at the same time can never oversell the departure.
 * External systems (REST adapter) plug in here through @ap/adapters in the next iteration.
 */
@Injectable()
export class AvailabilityService {
  async slot(db: DbOrTx, tenantId: string, slotId: string): Promise<Slot> {
    const [slot] = await db
      .select()
      .from(slots)
      .where(and(eq(slots.id, slotId), eq(slots.tenantId, tenantId)));
    if (!slot) throw new DomainError('departure not found', HttpStatus.NOT_FOUND);
    return slot;
  }

  /** Reserves seats and records a hold that expires if the customer does not pay. */
  async hold(db: DbOrTx, slot: Slot, seats: number, expiresAt: Date, now: Date): Promise<string> {
    if (slot.closed || slot.startsAt <= now) {
      throw new DomainError('this departure can no longer be booked', HttpStatus.CONFLICT);
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
      throw new DomainError(`only ${left} seats left on this departure`, HttpStatus.CONFLICT, {
        available: left,
      });
    }
    const [hold] = await db
      .insert(holds)
      .values({ tenantId: slot.tenantId, slotId: slot.id, seats, expiresAt })
      .returning({ id: holds.id });
    return hold!.id;
  }

  /** Re-reserves seats for a payment that arrived after its hold expired. Returns false if sold out. */
  async reserveLate(db: DbOrTx, slotId: string, seats: number): Promise<boolean> {
    const rows = await db
      .update(slots)
      .set({ reserved: sql`${slots.reserved} + ${seats}` })
      .where(and(eq(slots.id, slotId), sql`${slots.capacity} - ${slots.reserved} >= ${seats}`))
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

  /** Frees the seats of an unpaid hold. Idempotent. */
  async releaseHold(db: DbOrTx, holdId: string, now: Date): Promise<void> {
    const [hold] = await db
      .update(holds)
      .set({ releasedAt: now })
      .where(and(eq(holds.id, holdId), isNull(holds.releasedAt), isNull(holds.confirmedAt)))
      .returning();
    if (hold) await this.freeSeats(db, hold.slotId, hold.seats);
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
