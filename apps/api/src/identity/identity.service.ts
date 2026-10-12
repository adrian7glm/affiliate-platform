import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { MeDto, SessionDto } from '@ap/contracts';
import { type Database, affiliates, memberships, otpCodes, tenants, users } from '@ap/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import { generateOtp, hashOtp, signSession } from '../common/crypto';
import { DomainError } from '../common/errors';
import { Notifier } from '../common/notifier';
import { DB, type DbOrTx } from '../database/database.module';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;

export const isEmail = (destination: string) => destination.includes('@');

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async requestOtp(destination: string): Promise<void> {
    const now = this.clock.now();
    const [recent] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.destination, destination),
          gt(otpCodes.createdAt, new Date(now.getTime() - 3_600_000)),
        ),
      );
    if ((recent?.count ?? 0) >= OTP_MAX_PER_HOUR) {
      throw new DomainError(
        'too many codes requested, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = generateOtp();
    await this.db.insert(otpCodes).values({
      destination,
      codeHash: hashOtp(this.config.APP_SECRET, destination, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    });
    await this.notifier.send({
      to: destination,
      subject: 'Codul tău de conectare',
      text: `Codul tău de conectare este ${code}. Expiră în 10 minute.`,
    });
  }

  async verifyOtp(destination: string, code: string): Promise<SessionDto> {
    const now = this.clock.now();
    const [otp] = await this.db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.destination, destination),
          isNull(otpCodes.consumedAt),
          gt(otpCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new DomainError('the code has expired, ask for a new one', HttpStatus.UNAUTHORIZED);
    }
    if (otp.codeHash !== hashOtp(this.config.APP_SECRET, destination, code)) {
      await this.db
        .update(otpCodes)
        .set({ attempts: sql`${otpCodes.attempts} + 1` })
        .where(eq(otpCodes.id, otp.id));
      throw new DomainError('wrong code', HttpStatus.UNAUTHORIZED);
    }
    await this.db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, otp.id));
    const userId = await this.findOrCreateUser(this.db, destination);
    const me = await this.me(userId);
    return {
      ...me,
      token: signSession(this.config.APP_SECRET, userId, SESSION_TTL_SECONDS, now.getTime()),
    };
  }

  async findOrCreateUser(db: DbOrTx, destination: string, name?: string): Promise<string> {
    const column = isEmail(destination) ? users.email : users.phone;
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(column, destination));
    if (existing) return existing.id;
    const [created] = await db
      .insert(users)
      .values(isEmail(destination) ? { email: destination, name } : { phone: destination, name })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (created) return created.id;
    const [raced] = await db.select({ id: users.id }).from(users).where(eq(column, destination));
    if (!raced) throw new Error('could not create user');
    return raced.id;
  }

  async me(userId: string): Promise<MeDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new DomainError('user not found', HttpStatus.UNAUTHORIZED);
    const rows = await this.db
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        role: memberships.role,
        affiliateId: affiliates.id,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .leftJoin(
        affiliates,
        and(
          eq(affiliates.tenantId, memberships.tenantId),
          eq(affiliates.userId, memberships.userId),
          eq(memberships.role, 'affiliate'),
        ),
      )
      .where(eq(memberships.userId, userId))
      .orderBy(tenants.name);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isPlatformAdmin: user.isPlatformAdmin,
      },
      memberships: rows.map((r) => ({
        ...r,
        affiliateId: r.role === 'affiliate' ? r.affiliateId : null,
      })),
    };
  }
}
