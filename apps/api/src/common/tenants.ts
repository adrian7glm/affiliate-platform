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

  /** For public pages: only operators that are not suspended. */
  async bySlug(slug: string): Promise<Tenant> {
    const [tenant] = await this.db.select().from(tenants).where(eq(tenants.slug, slug));
    // A suspended operator's public pages are offline.
    if (!tenant || tenant.status === 'suspended') throw new NotFound('operator');
    return tenant;
  }
}
