import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database, type DbHandle } from '@ap/db';
import { APP_CONFIG, type AppConfig } from '../config';

export const DB_HANDLE = Symbol('DB_HANDLE');
export const DB = Symbol('DB');

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Repository methods accept either the pool or an open transaction. */
export type DbOrTx = Database | Tx;

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DbHandle => createDb(config.DATABASE_URL),
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (handle: DbHandle): Database => handle.db },
  ],
  exports: [DB, DB_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
