import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDb, memberships, runMigrations, tenants, users } from '@ap/db';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Clock } from '../src/common/clock';
import { loadConfig } from '../src/config';
import { NotificationsService } from '../src/notifications/notifications.service';
import { MemoryTransport, type SentMessage } from '../src/notifications/transports/dev';
import { EmailTransport, SmsTransport } from '../src/notifications/transports/transport';
import { Outbox } from '../src/outbox/outbox';
import { PaymentsGateway } from '../src/payments/gateway';
import type { FakeGateway } from '../src/payments/fake.gateway';

export class TestClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  now(): Date {
    return new Date(this.current);
  }
  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export const databaseUrl = process.env.TEST_DATABASE_URL;

export async function resetDatabase(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  await handle.db.execute(sql`drop schema if exists public cascade`);
  await handle.db.execute(sql`drop schema if exists drizzle cascade`);
  await handle.db.execute(sql`create schema public`);
  await runMigrations(handle.db);
  await handle.close();
}

export interface Harness {
  app: INestApplication;
  http: ReturnType<typeof request>;
  clock: TestClock;
  /** Every SMS and email sent. */
  messages: MemoryTransport;
  notifications: NotificationsService;
  /** Sends the queued messages, then returns the last one sent to `to`. */
  lastMessage(to: string): Promise<SentMessage | undefined>;
  outbox: Outbox;
  payments: FakeGateway;
  tenantId: string;
  ownerEmail: string;
  close(): Promise<void>;
}

/** Boots the whole API against a fresh database, with a controllable clock and in-memory SMS and email. */
export async function startHarness(
  url: string,
  now: string,
  env: Record<string, string> = {},
): Promise<Harness> {
  await resetDatabase(url);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    WEB_URL: 'http://web.test',
    APP_SECRET: 'test-secret-that-is-long-enough',
    PAYMENTS_PROVIDER: 'fake',
    WORKER_ENABLED: 'false',
    HOLD_MINUTES: '30',
    RATE_LIMITS: 'off',
    ...env,
  });
  const clock = new TestClock(new Date(now));
  const messages = new MemoryTransport();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.with(config)] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(EmailTransport)
    .useValue(messages.email)
    .overrideProvider(SmsTransport)
    .useValue(messages.sms)
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication({ rawBody: true, logger: ['error'] }),
    config,
  );
  await app.init();

  const seed = createDb(url, { max: 1 });
  const [tenant] = await seed.db
    .insert(tenants)
    .values({ slug: 'delta-boats', name: 'Delta Boats', allowPayOnSite: true, platformFeeBps: 300 })
    .returning();
  const ownerEmail = 'owner@delta.test';
  const [owner] = await seed.db
    .insert(users)
    .values({ email: ownerEmail, name: 'Owner' })
    .returning();
  await seed.db
    .insert(memberships)
    .values({ userId: owner!.id, tenantId: tenant!.id, role: 'owner' });
  await seed.close();

  const notifications = app.get(NotificationsService);
  return {
    app,
    http: request(app.getHttpServer()),
    clock,
    messages,
    notifications,
    lastMessage: async (to) => {
      await notifications.deliverDue();
      return messages.last(to);
    },
    outbox: app.get(Outbox),
    payments: app.get(PaymentsGateway) as FakeGateway,
    tenantId: tenant!.id,
    ownerEmail,
    close: () => app.close(),
  };
}

/** Signs in through the real OTP flow, reading the code from the in-memory SMS and email. */
export async function signIn(h: Harness, destination: string): Promise<string> {
  await h.http.post('/auth/otp/request').send({ destination }).expect(204);
  const code = /(\d{6})/.exec(h.messages.last(destination)?.text ?? '')?.[1];
  if (!code) throw new Error(`no login code sent to ${destination}`);
  const response = await h.http.post('/auth/otp/verify').send({ destination, code }).expect(200);
  return response.body.token as string;
}
