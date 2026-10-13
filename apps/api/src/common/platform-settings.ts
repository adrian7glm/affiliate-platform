import { Inject, Injectable } from '@nestjs/common';
import { type Database, platformSettings } from '@ap/db';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module';

/** Platform-wide switches and their values when the platform owner never changed them. */
const DEFAULTS = {
  /** Sign-in codes by SMS. Off until the platform owner turns it on in the admin area. */
  sms_login: false,
} satisfies Record<string, boolean>;

export type PlatformSettingKey = keyof typeof DEFAULTS;

@Injectable()
export class PlatformSettings {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(key: PlatformSettingKey): Promise<boolean> {
    const [row] = await this.db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, key));
    return typeof row?.value === 'boolean' ? row.value : DEFAULTS[key];
  }

  async set(key: PlatformSettingKey, value: boolean): Promise<void> {
    await this.db
      .insert(platformSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: sql`now()` },
      });
  }
}
