import { type Database, workerHeartbeats } from '@ap/db';
import { sql } from 'drizzle-orm';
import type { WorkerJobDto } from '@ap/contracts';

/** The background jobs and how often each runs. */
export const JOBS = {
  outbox: 3_000,
  'send-notifications': 3_000,
  'expire-unpaid-bookings': 60_000,
  'approve-commissions': 10 * 60_000,
  'sync-availability-sources': 10 * 60_000,
  'clean-up-old-rows': 6 * 60 * 60_000,
} as const satisfies Record<string, number>;

export type JobName = keyof typeof JOBS;

/** A job that has not run for this many of its intervals counts as stopped. */
const STALE_AFTER_INTERVALS = 3;
/** Short jobs still get a few minutes, so a slow outbox run is not reported as a dead worker. */
const MIN_STALE_MS = 5 * 60_000;

export async function recordHeartbeat(
  db: Database,
  job: JobName,
  at: Date,
  error: string | null,
): Promise<void> {
  await db
    .insert(workerHeartbeats)
    .values({ job, lastRunAt: at, lastError: error })
    .onConflictDoUpdate({
      target: workerHeartbeats.job,
      set: { lastRunAt: at, lastError: error },
    });
}

/** Whether the worker is running, from the heartbeats it leaves in the database. */
export async function workerStatus(
  db: Database,
  now: Date,
): Promise<{ status: 'ok' | 'stale' | 'unknown'; jobs: WorkerJobDto[] }> {
  const rows = await db
    .select()
    .from(workerHeartbeats)
    .where(sql`true`);
  const byJob = new Map(rows.map((row) => [row.job, row]));
  const jobs = (Object.entries(JOBS) as [JobName, number][]).map(([job, everyMs]) => {
    const row = byJob.get(job);
    const staleAfter = Math.max(everyMs * STALE_AFTER_INTERVALS, MIN_STALE_MS);
    return {
      job,
      everySeconds: everyMs / 1000,
      lastRunAt: row?.lastRunAt.toISOString() ?? null,
      lastError: row?.lastError ?? null,
      stale: !row || now.getTime() - row.lastRunAt.getTime() > staleAfter,
    };
  });
  // The clean-up runs rarely and right after start-up; it does not tell whether the worker is up.
  const watched = jobs.filter((j) => j.job !== 'clean-up-old-rows');
  const status = rows.length === 0 ? 'unknown' : watched.some((j) => j.stale) ? 'stale' : 'ok';
  return { status, jobs };
}
