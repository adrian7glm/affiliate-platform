import { Controller, Get, Inject } from '@nestjs/common';
import type { Database } from '@ap/db';
import { sql } from 'drizzle-orm';
import { DB } from './database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  async health(): Promise<{ status: 'ok' }> {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
