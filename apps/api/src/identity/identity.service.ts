import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { MeDto, SessionDto, VerifyOtpResultDto } from '@ap/contracts';
import { type Database, affiliates, memberships, otpCodes, tenants, users } from '@ap/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import { isPlatformAdmin } from '../common/auth';
import {
  generateOtp,
  hashOtp,
  hashRecoveryCode,
  matchTotp,
  openSecret,
  signMfaChallenge,
  signSession,
  verifyMfaChallenge,
} from '../common/crypto';
import { DomainError } from '../common/errors';
import { DB, type DbOrTx } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_HOUR = 5;
/** With 5 tries per code, at most 50 guesses a day at one account's 1,000,000 codes. */
const OTP_MAX_PER_DAY = 10;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;
/** Time to open the authenticator app after the SMS/email code. */
const MFA_CHALLENGE_TTL_SECONDS = 10 * 60;
/** Wrong second-step codes in a row before the second step locks, and for how long. */
const MFA_MAX_FAILURES = 5;
const MFA_LOCK_MS = 15 * 60_000;

export type UserRow = typeof users.$inferSelect;

export const isEmail = (destination: string) => destination.includes('@');

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async requestOtp(destination: string, locale = 'en'): Promise<void> {
    const now = this.clock.now();
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [recent] = await this.db
      .select({
        day: sql<number>`count(*)::int`,
        hour: sql<number>`(count(*) filter (where ${otpCodes.createdAt} > ${hourAgo.toISOString()}::timestamptz))::int`,
      })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.destination, destination),
          gt(otpCodes.createdAt, new Date(now.getTime() - 86_400_000)),
        ),
      );
    if ((recent?.hour ?? 0) >= OTP_MAX_PER_HOUR || (recent?.day ?? 0) >= OTP_MAX_PER_DAY) {
      throw new DomainError('errors.auth.tooManyCodes', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtp();
    await this.db.insert(otpCodes).values({
      destination,
      codeHash: hashOtp(this.config.APP_SECRET, destination, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      createdAt: now,
    });
    await this.notifications.sendNow({
      to: destination,
      template: 'login_code',
      locale,
      params: { code, webHost: new URL(this.config.WEB_URL).hostname },
    });
  }

  /** Checks a code sent by SMS or email to `destination`, and uses it up. */
  async consumeOtp(destination: string, code: string): Promise<void> {
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
      throw new DomainError('errors.auth.codeExpired', HttpStatus.UNAUTHORIZED);
    }
    if (otp.codeHash !== hashOtp(this.config.APP_SECRET, destination, code)) {
      await this.db
        .update(otpCodes)
        .set({ attempts: sql`${otpCodes.attempts} + 1` })
        .where(eq(otpCodes.id, otp.id));
      throw new DomainError('errors.auth.wrongCode', HttpStatus.UNAUTHORIZED);
    }
    const consumed = await this.db
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    // Two requests with the same code at once: only one of them signs in.
    if (consumed.length === 0) {
      throw new DomainError('errors.auth.codeExpired', HttpStatus.UNAUTHORIZED);
    }
  }

  async verifyOtp(destination: string, code: string): Promise<VerifyOtpResultDto> {
    await this.consumeOtp(destination, code);
    const now = this.clock.now();
    const userId = await this.findOrCreateUser(this.db, destination);
    if (isEmail(destination) && this.config.PLATFORM_ADMIN_EMAILS.includes(destination)) {
      await this.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId));
    }
    const user = await this.user(userId);
    if (user.totpEnabledAt) {
      return {
        mfaRequired: true,
        mfaToken: signMfaChallenge(
          this.config.APP_SECRET,
          userId,
          MFA_CHALLENGE_TTL_SECONDS,
          now.getTime(),
          user.sessionVersion,
        ),
      };
    }
    return this.session(user);
  }

  /** Second login step: a code from the authenticator app or a recovery code. */
  async verifyMfa(mfaToken: string, code: string): Promise<SessionDto> {
    const now = this.clock.now();
    const claims = verifyMfaChallenge(this.config.APP_SECRET, mfaToken, now.getTime());
    if (!claims) throw new DomainError('errors.account.challengeExpired', HttpStatus.UNAUTHORIZED);
    const user = await this.user(claims.sub);
    if (!user.totpEnabledAt || claims.sv !== user.sessionVersion) {
      throw new DomainError('errors.account.challengeExpired', HttpStatus.UNAUTHORIZED);
    }
    await this.checkSecondFactor(user, code);
    return this.session(await this.user(user.id));
  }

  /**
   * Accepts a current code from the authenticator app (each one once) or an unused recovery
   * code (which is then used up). Too many wrong codes in a row lock the second step for a while.
   */
  async checkSecondFactor(user: UserRow, code: string): Promise<void> {
    const now = this.clock.now();
    if (!user.totpSecret || !user.totpEnabledAt) {
      throw new DomainError('errors.account.twoFactorNotOn', HttpStatus.CONFLICT);
    }
    if (user.totpLockedUntil && user.totpLockedUntil > now) {
      throw new DomainError('errors.account.twoFactorLocked', HttpStatus.TOO_MANY_REQUESTS);
    }
    const clean = code.replace(/\s/g, '');
    let accepted = false;
    if (/^\d{6}$/.test(clean)) {
      const secret = openSecret(this.config.APP_SECRET, user.totpSecret);
      const step = matchTotp(secret, clean, now.getTime(), user.totpLastStep);
      if (step !== null) {
        // Conditional on the last step, so the same code sent twice at once is accepted once.
        const updated = await this.db
          .update(users)
          .set({ totpLastStep: step, totpFailedAttempts: 0, totpLockedUntil: null })
          .where(and(eq(users.id, user.id), sql`coalesce(${users.totpLastStep}, -1) < ${step}`))
          .returning({ id: users.id });
        accepted = updated.length > 0;
      }
    } else {
      const hash = hashRecoveryCode(this.config.APP_SECRET, user.id, clean);
      const updated = await this.db
        .update(users)
        .set({
          totpRecoveryHashes: sql`${users.totpRecoveryHashes} - ${hash}::text`,
          totpFailedAttempts: 0,
          totpLockedUntil: null,
        })
        .where(and(eq(users.id, user.id), sql`${users.totpRecoveryHashes} ? ${hash}::text`))
        .returning({ id: users.id });
      accepted = updated.length > 0;
    }
    if (accepted) return;
    const failures = user.totpFailedAttempts + 1;
    await this.db
      .update(users)
      .set({
        totpFailedAttempts: failures >= MFA_MAX_FAILURES ? 0 : failures,
        totpLockedUntil:
          failures >= MFA_MAX_FAILURES
            ? new Date(now.getTime() + MFA_LOCK_MS)
            : user.totpLockedUntil,
      })
      .where(eq(users.id, user.id));
    throw new DomainError(
      failures >= MFA_MAX_FAILURES
        ? 'errors.account.twoFactorLocked'
        : 'errors.account.twoFactorWrongCode',
      failures >= MFA_MAX_FAILURES ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  async user(userId: string): Promise<UserRow> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    return user;
  }

  /** A session token for the user's current session version. */
  token(user: Pick<UserRow, 'id' | 'sessionVersion'>): string {
    return signSession(
      this.config.APP_SECRET,
      user.id,
      SESSION_TTL_SECONDS,
      this.clock.now().getTime(),
      user.sessionVersion,
    );
  }

  private async session(user: UserRow): Promise<SessionDto> {
    const me = await this.me(user.id);
    return { ...me, token: this.token(user) };
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
    if (!user) throw new DomainError('errors.notFound.user', HttpStatus.UNAUTHORIZED);
    const rows = await this.db
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
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
        isPlatformAdmin: isPlatformAdmin(this.config, user),
        twoFactorEnabled: user.totpEnabledAt !== null,
      },
      memberships: rows.map((r) => ({
        ...r,
        affiliateId: r.role === 'affiliate' ? r.affiliateId : null,
      })),
    };
  }
}
