import { Inject, Injectable } from '@nestjs/common';
import { type Database, tenants } from '@ap/db';
import { eq } from 'drizzle-orm';
import { DB, type DbOrTx } from '../database/database.module';
import { NotFound } from './errors';

export type Tenant = typeof tenants.$inferSelect;

@Injectable()
export class TenantsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(tenantId: string, db: DbOrTx = this.db): Promise<Tenant> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new NotFound('operator');
    return tenant;
  }

  async bySlug(slug: string): Promise<Tenant> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.slug, slug));
    if (!tenant) throw new NotFound('operator');
    return tenant;
  }
}
