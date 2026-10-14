import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Database } from '@ap/db';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { Clock } from './common/clock';
import { DB } from './database/database.module';
import { workerStatus } from './jobs/jobs';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** For the load balancer: the API answers and reaches the database. */
  @Get()
  async health(): Promise<{ status: 'ok' }> {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }

  /** For uptime monitoring: 503 when the background worker stopped running its jobs. */
  @Get('worker')
  async worker(
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: 'ok' | 'stale' | 'unknown'; stale: string[] }> {
    const worker = await workerStatus(this.db, this.clock.now());
    // Answered directly, not thrown: a monitor polling a stopped worker is not an API error.
    if (worker.status !== 'ok') response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: worker.status, stale: worker.jobs.filter((j) => j.stale).map((j) => j.job) };
  }
}
