import {
  type Database,
  auditLog,
  createDb,
  notifications,
  platformPlans,
  tenantSubscriptions,
} from '@ap/db';
import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../src/common/clock';
import { DB } from '../src/database/database.module';
import { I18nService } from '../src/i18n/i18n.service';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import {
  DeliveryError,
  EmailTransport,
  type OutgoingSms,
  SmsTransport,
} from '../src/notifications/transports/transport';
import { BillingGateway, type StripeBilling } from '../src/platform/billing.gateway';
import { type Harness, databaseUrl, signIn, startHarness } from './harness';

const WHSEC = 'whsec_test_billing';

interface FakeSession {
  id: string;
  url: string;
  status: 'open' | 'complete' | 'expired';
  customer: string;
  client_reference_id: string | null;
  metadata: Record<string, string>;
}

const later = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Operators paying the platform through Stripe Billing, with Stripe itself faked. */
describe.skipIf(!databaseUrl)('Stripe Billing for operators (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let owner: string;
  let admin: string;
  let handle: ReturnType<typeof createDb>;
  const adminEmail = 'adrian@platform.test';
  /** What Stripe holds: checkout sessions and subscriptions. */
  const sessions: FakeSession[] = [];
  const created: Stripe.Checkout.SessionCreateParams[] = [];
  const subscriptions = new Map<string, object>();
  let expireFails = false;
  let completedWhileExpiring = false;
  let slowRetrieve = false;

  const subscription = (id: string, status: string) => ({
    id,
    object: 'subscription',
    customer: 'cus_1',
    status,
    metadata: { tenantId: h.tenantId },
    trial_end: null,
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_793_000_000 }] },
  });

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z', {
      BILLING_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_billing',
      STRIPE_BILLING_WEBHOOK_SECRET: WHSEC,
      PLATFORM_ADMIN_EMAILS: adminEmail,
    });
    owner = await signIn(h, h.ownerEmail);
    admin = await signIn(h, adminEmail);

    const stripe = (h.app.get(BillingGateway) as StripeBilling).stripe;
    const fake = (target: object, methods: Record<string, unknown>) =>
      Object.assign(target, methods);
    fake(stripe.customers, {
      create: async () => {
        await later();
        return { id: 'cus_1' };
      },
    });
    fake(stripe.checkout.sessions, {
      list: async (p: Stripe.Checkout.SessionListParams) => ({
        data: sessions.filter((s) => s.customer === p.customer && s.status === p.status),
      }),
      create: async (p: Stripe.Checkout.SessionCreateParams) => {
        await later();
        created.push(p);
        const id = `cs_${created.length}`;
        const session: FakeSession = {
          id,
          url: `https://checkout.stripe.test/${id}`,
          status: 'open',
          customer: p.customer!,
          client_reference_id: p.client_reference_id ?? null,
          metadata: p.metadata as Record<string, string>,
        };
        sessions.push(session);
        return session;
      },
      expire: async (id: string) => {
        if (completedWhileExpiring) {
          // The operator pays the old checkout in another tab just as it is being closed.
          completedWhileExpiring = false;
          sessions.find((s) => s.id === id)!.status = 'complete';
          throw new Error('This Checkout Session is already complete');
        }
        if (expireFails) throw new Error('Stripe timed out');
        const session = sessions.find((s) => s.id === id)!;
        session.status = 'expired';
        return session;
      },
      retrieve: async (id: string) => sessions.find((s) => s.id === id),
    });
    fake(stripe.subscriptions, {
      retrieve: async (id: string) => {
        // What Stripe had when asked; a slow answer arrives after newer changes were made.
        const answer = structuredClone(subscriptions.get(id));
        if (slowRetrieve) {
          slowRetrieve = false;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        return answer;
      },
      list: async (p: Stripe.SubscriptionListParams) => ({
        data: [...subscriptions.values()].filter(
          (s) => (s as { customer: string }).customer === p.customer,
        ),
      }),
    });
    fake(stripe.billingPortal.sessions, {
      create: async () => ({ url: 'https://billing.stripe.test/portal' }),
    });

    handle = createDb(databaseUrl!, { max: 1 });
    const [plan] = await handle.db
      .insert(platformPlans)
      .values({
        code: 'stripe-pro',
        name: 'Pro',
        monthlyPriceMinor: 4900,
        platformFeeBps: 200,
        stripePriceId: 'price_pro',
      })
      .returning();
    await handle.db.insert(tenantSubscriptions).values({
      tenantId: h.tenantId,
      planId: plan!.id,
      status: 'trialing',
      trialEndsAt: new Date('2026-10-15T00:00:00Z'),
      // Saved before Stripe Billing was switched on: Stripe would never charge it.
      priceMinorOverride: 1900,
    });
  });

  afterAll(async () => {
    await handle?.close();
    await h?.close();
  });

  const op = (method: 'get' | 'post', path: string) =>
    h.http[method](path).set('authorization', `Bearer ${owner}`).set('x-tenant-id', h.tenantId);

  let eventCount = 0;
  function webhook(type: string, object: object) {
    const payload = JSON.stringify({
      id: `evt_${++eventCount}`,
      object: 'event',
      type,
      created: 1_790_000_000 + eventCount,
      data: { object },
    });
    return h.http
      .post('/webhooks/stripe/billing')
      .set('stripe-signature', Stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC }))
      .set('content-type', 'application/json')
      .send(payload)
      .expect(200);
  }

  const row = async () =>
    (
      await handle.db
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, h.tenantId))
    )[0]!;

  it('refuses a negotiated monthly price, which Stripe would not charge', async () => {
    const billing = (await op('get', '/operator/billing').expect(200)).body;
    expect(billing.subscription).toMatchObject({
      monthlyPriceMinor: 4900,
      priceMinorOverride: null,
      priceOverrideAllowed: false,
    });

    const refused = await h.http
      .patch(`/admin/tenants/${h.tenantId}/billing`)
      .set('authorization', `Bearer ${admin}`)
      .send({ priceMinorOverride: 1500 })
      .expect(422);
    expect(refused.body.code).toBe('errors.platform.priceOverrideStripe');

    // Clearing an old one, and every other change, still works.
    const saved = await h.http
      .patch(`/admin/tenants/${h.tenantId}/billing`)
      .set('authorization', `Bearer ${admin}`)
      .send({ priceMinorOverride: null, feeBpsOverride: 150 })
      .expect(200);
    expect(saved.body).toMatchObject({ platformFeeBps: 150, monthlyPriceMinor: 4900 });
    expect((await row()).priceMinorOverride).toBeNull();
  });

  it('opens one Stripe Checkout however many times the operator clicks', async () => {
    const [first, second] = await Promise.all([
      op('post', '/operator/billing/checkout').send({}).expect(201),
      op('post', '/operator/billing/checkout').send({}).expect(201),
    ]);
    const third = await op('post', '/operator/billing/checkout').send({}).expect(201);
    expect(created).toHaveLength(1);
    expect(second.body.url).toBe(first.body.url);
    expect(third.body.url).toBe(first.body.url);
    expect(created[0]!.line_items).toEqual([{ price: 'price_pro', quantity: 1 }]);
    expect((await row()).stripeCustomerId).toBe('cus_1');
  });

  it('closes the open checkout when the operator picks another plan', async () => {
    const [max] = await handle.db
      .insert(platformPlans)
      .values({
        code: 'stripe-max',
        name: 'Max',
        monthlyPriceMinor: 9900,
        platformFeeBps: 100,
        stripePriceId: 'price_max',
      })
      .returning();
    const response = await op('post', '/operator/billing/checkout')
      .send({ planId: max!.id })
      .expect(201);
    expect(created).toHaveLength(2);
    expect(created[1]!.line_items).toEqual([{ price: 'price_max', quantity: 1 }]);
    expect(response.body.url).toBe(sessions[1]!.url);
    expect(sessions.map((s) => s.status)).toEqual(['expired', 'open']);
  });

  it('opens no second checkout while Stripe fails to close the first', async () => {
    const [pro] = await handle.db
      .select()
      .from(platformPlans)
      .where(eq(platformPlans.code, 'stripe-pro'));
    expireFails = true;
    try {
      await op('post', '/operator/billing/checkout').send({ planId: pro!.id }).expect(500);
    } finally {
      expireFails = false;
    }
    expect(created).toHaveLength(2);
    expect(sessions.map((s) => s.status)).toEqual(['expired', 'open']);
  });

  it('sends the operator to the portal when the old checkout was paid while being closed', async () => {
    const [pro] = await handle.db
      .select()
      .from(platformPlans)
      .where(eq(platformPlans.code, 'stripe-pro'));
    completedWhileExpiring = true;
    const response = await op('post', '/operator/billing/checkout')
      .send({ planId: pro!.id })
      .expect(201);
    expect(response.body.url).toBe('https://billing.stripe.test/portal');
    expect(created).toHaveLength(2);
    expect(sessions.map((s) => s.status)).toEqual(['expired', 'complete']);
  });

  it('sends the operator to the portal once Stripe has their subscription', async () => {
    // The checkout was completed; its webhook has not arrived yet.
    sessions[1]!.status = 'complete';
    subscriptions.set('sub_A', subscription('sub_A', 'active'));
    const response = await op('post', '/operator/billing/checkout').send({}).expect(201);
    expect(response.body.url).toBe('https://billing.stripe.test/portal');
    expect(created).toHaveLength(2);
  });

  it('keeps tracking the live subscription when a duplicate appears or one is canceled', async () => {
    await webhook('customer.subscription.created', subscription('sub_A', 'active'));
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_A', status: 'active' });

    // A second subscription (completed elsewhere) never replaces the one being tracked.
    subscriptions.set('sub_B', subscription('sub_B', 'active'));
    await webhook('customer.subscription.created', subscription('sub_B', 'active'));
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_A', status: 'active' });
    const [duplicate] = await handle.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tenantId, h.tenantId),
          eq(auditLog.action, 'subscription.stripe_duplicate'),
        ),
      );
    expect(duplicate?.data).toMatchObject({
      subscriptionId: 'sub_B',
      currentSubscriptionId: 'sub_A',
    });

    // The operator cancels one of the two: they still pay through the other.
    subscriptions.set('sub_A', subscription('sub_A', 'canceled'));
    await webhook('customer.subscription.deleted', subscription('sub_A', 'canceled'));
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_B', status: 'active' });
  });

  it('applies the subscription as Stripe has it now, whatever order events arrive in', async () => {
    subscriptions.set('sub_B', subscription('sub_B', 'canceled'));
    await webhook('customer.subscription.deleted', subscription('sub_B', 'canceled'));
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_B', status: 'canceled' });

    // An older "updated (active)" event, delivered late or retried, does not bring it back.
    await webhook('customer.subscription.updated', subscription('sub_B', 'active'));
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_B', status: 'canceled' });
    const billing = (await op('get', '/operator/billing').expect(200)).body;
    expect(billing.subscription.status).toBe('canceled');
  });

  it('keeps the newer state when two webhooks for the operator arrive at the same moment', async () => {
    subscriptions.set('sub_B', subscription('sub_B', 'active'));
    // The first webhook reads "active" from Stripe, but its answer is slow…
    slowRetrieve = true;
    const first = webhook('customer.subscription.updated', subscription('sub_B', 'active')).then(
      (r) => r,
    );
    // Started now (a request is only sent once awaited), and given time to ask Stripe.
    await new Promise((resolve) => setTimeout(resolve, 100));
    // …and meanwhile the subscription is canceled and that webhook is handled.
    subscriptions.set('sub_B', subscription('sub_B', 'canceled'));
    const second = webhook('customer.subscription.deleted', subscription('sub_B', 'canceled'));
    await Promise.all([first, second]);
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_B', status: 'canceled' });
  });

  it('handles many webhooks for one operator at once without running out of connections', async () => {
    subscriptions.set('sub_B', subscription('sub_B', 'canceled'));
    slowRetrieve = true;
    // More at once than the API's 10 database connections.
    const all = Array.from({ length: 12 }, () =>
      webhook('customer.subscription.updated', subscription('sub_B', 'canceled')).then((r) => r),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stuck = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('webhooks stuck waiting for connections')), 4000);
    });
    try {
      await Promise.race([Promise.all(all), stuck]);
    } finally {
      clearTimeout(timer);
    }
    expect(await row()).toMatchObject({ stripeSubscriptionId: 'sub_B', status: 'canceled' });
  });
});

/** The worker: messages sent once even with slow providers, and one scheduler at a time. */
describe.skipIf(!databaseUrl)('background sending (needs TEST_DATABASE_URL)', () => {
  let h: Harness;
  let db: Database;

  beforeAll(async () => {
    h = await startHarness(databaseUrl!, '2026-10-05T08:00:00Z');
    db = h.app.get<Database>(DB);
  });

  afterAll(async () => {
    await h?.close();
  });

  const worker = (sms: SmsTransport) =>
    new NotificationsService(
      db,
      h.app.get(Clock),
      h.app.get(EmailTransport),
      sms,
      h.app.get(I18nService),
    );
  const sms = (send: (sms: OutgoingSms) => Promise<void>) =>
    new (class extends SmsTransport {
      readonly name = 'test';
      async send(message: OutgoingSms) {
        await send(message);
        return { provider: 'test', messageId: null };
      }
    })();
  const advance = (ms: number) => h.clock.set(new Date(h.clock.now().getTime() + ms).toISOString());
  async function enqueue(numbers: string[]) {
    for (const to of numbers) {
      await h.notifications.enqueue(db, {
        to,
        template: 'login_code',
        locale: 'en',
        params: { code: '123456', webHost: 'x' },
      });
      advance(1000);
    }
  }

  it('never lets a second worker send what a slow worker is still sending', async () => {
    const numbers = Array.from({ length: 8 }, (_, i) => `+4070000001${i}`);
    await enqueue(numbers);
    const sent: string[] = [];
    const start = h.clock.now().getTime();
    let secondRan = false;
    const fast = worker(sms(async (m) => void sent.push(m.to)));
    // Every SMS takes 70 seconds; once the first worker's batch is 5 minutes old, a second
    // worker runs its own round.
    const slow = worker(
      sms(async (m) => {
        sent.push(m.to);
        advance(70_000);
        if (!secondRan && h.clock.now().getTime() - start > 5 * 60_000) {
          secondRan = true;
          await fast.deliverDue();
        }
      }),
    );
    await slow.deliverDue();
    expect(secondRan).toBe(true);
    expect([...sent].sort()).toEqual(numbers);
    const rows = await db.select().from(notifications);
    expect(rows.filter((r) => numbers.includes(r.recipient)).map((r) => r.status)).toEqual(
      numbers.map(() => 'sent'),
    );
  });

  it('keeps the result of the worker that took over a message whose lease ran out', async () => {
    await enqueue(['+40700000020']);
    const fast = worker(sms(async () => undefined));
    // A hung send: 6 minutes later another worker has sent it, then this one fails.
    const hung = worker(
      sms(async () => {
        advance(6 * 60_000);
        await fast.deliverDue();
        throw new DeliveryError('timed out', false);
      }),
    );
    await hung.deliverDue();
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.recipient, '+40700000020'));
    expect(row).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
  });

  it('runs the background jobs in one worker process at a time', async () => {
    const scheduler = h.app.get(SchedulerService);
    const other = createDb(databaseUrl!, { max: 1 });
    // Another worker holds the scheduler lock: this one stands by.
    await other.pool.query('select pg_advisory_lock(7042027)');
    expect(await scheduler.lead()).toBe(false);
    // It stopped: this one takes over.
    await other.close();
    expect(await scheduler.lead()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    scheduler.onApplicationShutdown();
  });
});
