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
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { randomCode } from './common/crypto';
import { loadDotEnv } from './env';

/**
 * Local demo data: one operator, a progressive plan, a trip with departures for the next
 * 30 days and one affiliate. Safe to run again: it does nothing if the demo operator exists.
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
      return;
    }
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
        .values({ phone: '+40700000001', name: 'Ana' })
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
    console.log('demo data created');
    console.log('  platform admin:  admin@demo.test (open /admin)');
    console.log('  operator login:  owner@demo.test');
    console.log('  affiliate login: +40700000001');
    console.log(
      '  login codes are printed in the API log (EMAIL_PROVIDER=console, SMS_PROVIDER=console)',
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
