import 'reflect-metadata';
import {
  affiliateLinks,
  affiliates,
  commissionPlans,
  createDb,
  memberships,
  platformPlans,
  productPrices,
  products,
  slots,
  tenantSubscriptions,
  tenants,
  users,
} from '@ap/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { hashPassword, randomCode } from './common/crypto';
import { loadDotEnv } from './env';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './identity/demo-accounts';

type Db = ReturnType<typeof createDb>['db'];

/**
 * Local demo data: one operator, a progressive plan, a trip with departures for the next
 * 30 days, one affiliate and one ticket scanner, each with an email + password demo login.
 * Safe to run again: existing demo data is kept and only the demo logins are brought up to date.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(url, { max: 1 });
  try {
    const [existing] = await db.select().from(tenants).where(eq(tenants.slug, 'delta-boats'));
    if (existing) {
      console.log('demo data already present');
    } else {
      await createDemoData(db);
      console.log('demo data created');
    }
    await ensureDemoLogins(db);
    console.log(`demo logins (password ${DEMO_PASSWORD}, listed on /login while DEMO_MODE is on):`);
    for (const account of DEMO_ACCOUNTS)
      console.log(`  ${account.role.padEnd(10)} ${account.email}`);
    console.log('  the affiliate can also sign in by SMS code on +40700000001 when SMS is on');
  } finally {
    await close();
  }
}

async function createDemoData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: 'delta-boats',
        name: 'Delta Boats',
        allowPayOnSite: true,
        platformFeeBps: 300,
      })
      .returning();
    const tenantId = tenant!.id;
    const [owner] = await tx
      .insert(users)
      .values({ email: 'owner@demo.test', name: 'Operator Demo' })
      .returning();
    await tx.insert(memberships).values({ userId: owner!.id, tenantId, role: 'owner' });

    // The platform owner (admin area at /admin) and the demo operator's trial on Start.
    await tx
      .insert(users)
      .values({ email: 'admin@demo.test', name: 'Admin platformă', isPlatformAdmin: true })
      .onConflictDoNothing();
    const [start] = await tx.select().from(platformPlans).where(eq(platformPlans.code, 'start'));
    if (start) {
      await tx.insert(tenantSubscriptions).values({
        tenantId,
        planId: start.id,
        status: 'trialing',
        trialEndsAt: DateTime.now().plus({ days: start.trialDays }).toJSDate(),
      });
      await tx
        .update(tenants)
        .set({ platformFeeBps: start.platformFeeBps })
        .where(eq(tenants.id, tenantId));
    }

    const [plan] = await tx
      .insert(commissionPlans)
      .values({
        tenantId,
        name: 'Standard progresiv',
        kind: 'tiered',
        mode: 'marginal',
        tiers: [
          { fromSale: 1, rateBps: 1500 },
          { fromSale: 4, rateBps: 2000 },
          { fromSale: 11, rateBps: 2500 },
        ],
        isDefault: true,
      })
      .returning();

    const [product] = await tx
      .insert(products)
      .values({
        tenantId,
        slug: 'plimbare-la-apus',
        name: 'Plimbare cu barca la apus',
        description: 'O oră și jumătate pe lac, la apus, cu un pahar de prosecco inclus.',
        durationMinutes: 90,
        meetingPoint: 'Debarcaderul 3, Tulcea',
      })
      .returning();
    await tx.insert(productPrices).values([
      {
        tenantId,
        productId: product!.id,
        code: 'adult',
        label: 'Adult',
        amountMinor: 15_000,
        taxRateBps: 900,
      },
      {
        tenantId,
        productId: product!.id,
        code: 'child',
        label: 'Copil (4-12 ani)',
        amountMinor: 7_500,
        taxRateBps: 900,
      },
    ]);
    const today = DateTime.now().setZone(tenant!.timezone).startOf('day');
    const departures = [];
    for (let day = 0; day < 30; day += 1) {
      for (const hour of [10, 14, 18]) {
        const start = today.plus({ days: day }).set({ hour });
        departures.push({
          tenantId,
          productId: product!.id,
          startsAt: start.toJSDate(),
          endsAt: start.plus({ minutes: 90 }).toJSDate(),
          capacity: 20,
        });
      }
    }
    await tx.insert(slots).values(departures);

    const [user] = await tx
      .insert(users)
      .values({ phone: '+40700000001', email: 'ana@demo.test', name: 'Ana' })
      .returning();
    const [affiliate] = await tx
      .insert(affiliates)
      .values({
        tenantId,
        userId: user!.id,
        displayName: 'Ana, Hotel Central',
        status: 'active',
        commissionPlanId: plan!.id,
      })
      .returning();
    await tx.insert(memberships).values({ userId: user!.id, tenantId, role: 'affiliate' });
    await tx
      .insert(affiliateLinks)
      .values({ tenantId, affiliateId: affiliate!.id, code: randomCode(7), label: 'General' });
  });
}

/**
 * Gives every demo account the demo password, the affiliate an email address and the demo
 * operator a ticket scanner. Databases seeded before demo logins existed get them too.
 */
async function ensureDemoLogins(db: Db): Promise<void> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'delta-boats'));
  if (!tenant) return;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db
    .update(users)
    .set({ email: 'ana@demo.test' })
    .where(and(eq(users.phone, '+40700000001'), isNull(users.email)));
  const [scanner] = await db
    .insert(users)
    .values({ email: 'scanner@demo.test', name: 'Ion' })
    .onConflictDoNothing()
    .returning();
  if (scanner) {
    await db
      .insert(memberships)
      .values({ userId: scanner.id, tenantId: tenant.id, role: 'scanner' })
      .onConflictDoNothing();
  }
  for (const account of DEMO_ACCOUNTS) {
    await db.update(users).set({ passwordHash }).where(eq(users.email, account.email));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
