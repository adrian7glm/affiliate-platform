import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthOptionsDto, MeDto, Role, SessionDto, VerifyOtpResultDto } from '@ap/contracts';
import { type Database, affiliates, memberships, otpCodes, tenants, users } from '@ap/db';
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import { isPlatformAdmin } from '../common/auth';
import {
  generateOtp,
  hashOtp,
  hashPassword,
  hashRecoveryCode,
  matchTotp,
  openSecret,
  randomToken,
  signLoginStep,
  signMfaChallenge,
  signSession,
  verifyLoginStep,
  verifyMfaChallenge,
  verifyPassword,
} from '../common/crypto';
import { DomainError } from '../common/errors';
import { PlatformSettings } from '../common/platform-settings';
import { DB, type DbOrTx } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo-accounts';
import { GoogleClient } from './google.client';

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

/** Wrong passwords allowed per email address in PASSWORD_WINDOW_MS. */
const PASSWORD_MAX_FAILURES = 10;
const PASSWORD_WINDOW_MS = 15 * 60_000;
const GOOGLE_STATE_TTL_SECONDS = 10 * 60;
const HANDOFF_TTL_SECONDS = 2 * 60;

/** Where the API sends the browser back to after Google, in the web app. */
export interface GoogleReturn {
  /** Absolute URL of the web app's sign-in page. */
  redirect: string;
}

export const isEmail = (destination: string) => destination.includes('@');

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
    private readonly settings: PlatformSettings,
    private readonly google: GoogleClient,
  ) {}

  /** Failed password attempts per email, kept in memory: a restart only gives a few more tries. */
  private readonly passwordFailures = new Map<string, { count: number; until: number }>();

  /** SMS codes need the platform owner's switch and a configured SMS provider. */
  async smsLoginEnabled(): Promise<boolean> {
    return this.config.SMS_PROVIDER !== 'disabled' && (await this.settings.get('sms_login'));
  }

  async options(): Promise<AuthOptionsDto> {
    return {
      sms: await this.smsLoginEnabled(),
      google: this.google.enabled,
      demoAccounts: this.config.DEMO_MODE ? await this.demoAccounts() : [],
    };
  }

  /** The demo accounts that exist with a password in this database. */
  private async demoAccounts(): Promise<AuthOptionsDto['demoAccounts']> {
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          inArray(
            users.email,
            DEMO_ACCOUNTS.map((a) => a.email),
          ),
          isNotNull(users.passwordHash),
        ),
      );
    const present = new Set(rows.map((r) => r.email));
    return DEMO_ACCOUNTS.filter((a) => present.has(a.email)).map((a) => ({
      ...a,
      password: DEMO_PASSWORD,
    }));
  }

  async requestOtp(destination: string, locale = 'en'): Promise<void> {
    const now = this.clock.now();
    if (!isEmail(destination) && !(await this.smsLoginEnabled())) {
      throw new DomainError('errors.auth.smsOff', HttpStatus.FORBIDDEN);
    }
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
    const userId = await this.findOrCreateUser(this.db, destination);
    return this.completeLogin(userId);
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

  async loginWithPassword(email: string, password: string): Promise<VerifyOtpResultDto> {
    const now = this.clock.now().getTime();
    const failures = this.passwordFailures.get(email);
    if (failures && failures.until > now && failures.count >= PASSWORD_MAX_FAILURES) {
      throw new DomainError('errors.auth.tooManyAttempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));
    // Hash anyway when there is no password, so the answer takes as long either way.
    const ok = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : (await hashPassword(password), false);
    if (!user || !ok) {
      const current = failures && failures.until > now ? failures.count : 0;
      this.passwordFailures.set(email, { count: current + 1, until: now + PASSWORD_WINDOW_MS });
      throw new DomainError('errors.auth.wrongPassword', HttpStatus.UNAUTHORIZED);
    }
    this.passwordFailures.delete(email);
    return this.completeLogin(user.id);
  }

  /** First password, or a forgotten one: proven with a code sent to the email address. */
  async resetPassword(email: string, code: string, password: string): Promise<VerifyOtpResultDto> {
    await this.consumeOtp(email, code);
    const userId = await this.findOrCreateUser(this.db, email);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, userId));
    this.passwordFailures.delete(email);
    return this.completeLogin(userId);
  }

  /**
   * Starts "Sign in with Google". The nonce goes in a cookie and, signed, in Google's `state`,
   * so the answer can only finish a sign-in this browser started.
   */
  googleStart(next: string | undefined): { url: string; nonce: string } {
    if (!this.google.enabled) throw new DomainError('errors.auth.googleOff', HttpStatus.NOT_FOUND);
    const nonce = randomToken(16);
    const state = signLoginStep(
      this.config.APP_SECRET,
      'google-state',
      JSON.stringify({ nonce, next: next ?? null }),
      GOOGLE_STATE_TTL_SECONDS,
      this.clock.now().getTime(),
    );
    return { url: this.google.authorizeUrl(state), nonce };
  }

  /**
   * Google sends the person back here. Signs in (or creates) the account with that Google
   * email and returns the web page to open, carrying a short-lived token in the URL fragment.
   */
  async googleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    cookieNonce?: string;
  }): Promise<GoogleReturn> {
    const login = `${this.config.WEB_URL.replace(/\/+$/, '')}/login`;
    const fail = (reason: string): GoogleReturn => ({
      redirect: `${login}#google_error=${encodeURIComponent(reason)}`,
    });
    if (query.error) return fail('cancelled');
    const raw = query.state
      ? verifyLoginStep(
          this.config.APP_SECRET,
          'google-state',
          query.state,
          this.clock.now().getTime(),
        )
      : null;
    const state = raw ? (JSON.parse(raw) as { nonce: string; next: string | null }) : null;
    if (!state || !query.code || !query.cookieNonce || state.nonce !== query.cookieNonce) {
      return fail('expired');
    }
    let profile;
    try {
      profile = await this.google.profile(query.code);
    } catch {
      return fail('google');
    }
    if (!profile.email || !profile.emailVerified) return fail('email');
    const userId = await this.findOrCreateGoogleUser(profile.sub, profile.email, profile.name);
    const handoff = signLoginStep(
      this.config.APP_SECRET,
      'login-handoff',
      userId,
      HANDOFF_TTL_SECONDS,
      this.clock.now().getTime(),
    );
    const params = new URLSearchParams({ handoff });
    if (state.next) params.set('next', state.next);
    return { redirect: `${login}#${params.toString()}` };
  }

  /** The web app trades the token from the Google return for a session. */
  async exchangeHandoff(token: string): Promise<VerifyOtpResultDto> {
    const userId = verifyLoginStep(
      this.config.APP_SECRET,
      'login-handoff',
      token,
      this.clock.now().getTime(),
    );
    if (!userId) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    return this.completeLogin(userId);
  }

  private async findOrCreateGoogleUser(
    sub: string,
    email: string,
    name: string | null,
  ): Promise<string> {
    const [linked] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.googleSub, sub));
    if (linked) return linked.id;
    const userId = await this.findOrCreateUser(this.db, email, name ?? undefined);
    await this.db
      .update(users)
      .set({ googleSub: sub })
      .where(and(eq(users.id, userId), isNull(users.googleSub)));
    if (name) {
      await this.db
        .update(users)
        .set({ name })
        .where(and(eq(users.id, userId), isNull(users.name)));
    }
    return userId;
  }

  /**
   * Every way of signing in ends here: platform admin flag, then the second step for people with
   * two-step login on (a challenge for the authenticator app code), else the session.
   */
  private async completeLogin(userId: string): Promise<VerifyOtpResultDto> {
    let user = await this.user(userId);
    if (
      user.email &&
      !user.isPlatformAdmin &&
      this.config.PLATFORM_ADMIN_EMAILS.includes(user.email)
    ) {
      await this.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId));
      user = await this.user(userId);
    }
    if (user.totpEnabledAt) {
      return {
        mfaRequired: true,
        mfaToken: signMfaChallenge(
          this.config.APP_SECRET,
          userId,
          MFA_CHALLENGE_TTL_SECONDS,
          this.clock.now().getTime(),
          user.sessionVersion,
        ),
      };
    }
    return this.session(user);
  }

  /** Gives a user a role in an operator's account; false when they already had it. */
  async grantRole(db: DbOrTx, userId: string, tenantId: string, role: Role): Promise<boolean> {
    const created = await db
      .insert(memberships)
      .values({ userId, tenantId, role })
      .onConflictDoNothing()
      .returning({ id: memberships.id });
    return created.length > 0;
  }

  /** Takes a role away; false when the user did not have it. */
  async revokeRole(db: DbOrTx, userId: string, tenantId: string, role: Role): Promise<boolean> {
    const deleted = await db
      .delete(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.role, role),
        ),
      )
      .returning({ id: memberships.id });
    return deleted.length > 0;
  }

  /** Fills in a user's name when they have none, never replacing one they chose themselves. */
  async nameIfMissing(db: DbOrTx, userId: string, name: string): Promise<void> {
    await db
      .update(users)
      .set({ name })
      .where(and(eq(users.id, userId), sql`${users.name} is null`));
  }

  /** The language this person uses the app in; only written when it changed. */
  async setLocale(userId: string, locale: string): Promise<void> {
    await this.db
      .update(users)
      .set({ locale })
      .where(and(eq(users.id, userId), sql`${users.locale} is distinct from ${locale}`));
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
