import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AuthOptionsDto, MeDto, Role, SessionDto } from '@ap/contracts';
import { type Database, affiliates, memberships, otpCodes, tenants, users } from '@ap/db';
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config';
import { Clock } from '../common/clock';
import {
  generateOtp,
  hashOtp,
  hashPassword,
  randomToken,
  signLoginStep,
  signSession,
  verifyLoginStep,
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
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;
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
      throw new DomainError('errors.auth.tooManyCodes', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateOtp();
    await this.db.insert(otpCodes).values({
      destination,
      codeHash: hashOtp(this.config.APP_SECRET, destination, code),
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    });
    await this.notifications.sendNow({
      to: destination,
      template: 'login_code',
      locale,
      params: { code, webHost: new URL(this.config.WEB_URL).hostname },
    });
  }

  async verifyOtp(destination: string, code: string): Promise<SessionDto> {
    await this.consumeOtp(destination, code);
    const userId = await this.findOrCreateUser(this.db, destination);
    return this.completeLogin(userId);
  }

  /** Checks a sign-in code and uses it up. Wrong codes count towards OTP_MAX_ATTEMPTS. */
  private async consumeOtp(destination: string, code: string): Promise<void> {
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
    await this.db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, otp.id));
  }

  async loginWithPassword(email: string, password: string): Promise<SessionDto> {
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
  async resetPassword(email: string, code: string, password: string): Promise<SessionDto> {
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
  async exchangeHandoff(token: string): Promise<SessionDto> {
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

  /** Every way of signing in ends here: platform admin flag, profile and session token. */
  private async completeLogin(userId: string): Promise<SessionDto> {
    const [user] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.email && this.config.PLATFORM_ADMIN_EMAILS.includes(user.email)) {
      await this.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, userId));
    }
    const me = await this.me(userId);
    return {
      ...me,
      token: signSession(
        this.config.APP_SECRET,
        userId,
        SESSION_TTL_SECONDS,
        this.clock.now().getTime(),
      ),
    };
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
        isPlatformAdmin: user.isPlatformAdmin,
      },
      memberships: rows.map((r) => ({
        ...r,
        affiliateId: r.role === 'affiliate' ? r.affiliateId : null,
      })),
    };
  }
}
