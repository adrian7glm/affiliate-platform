import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AccountSecurityDto,
  AdminAccountDto,
  MeDto,
  NewSessionTokenDto,
  RecoveryCodesDto,
  TwoFactorEnabledDto,
  TwoFactorSetupDto,
} from '@ap/contracts';
import { type Database, auditLog, memberships, tenants, users } from '@ap/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { isPlatformAdmin } from '../common/auth';
import { Clock } from '../common/clock';
import {
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotp,
  openSecret,
  sealSecret,
  totpUri,
} from '../common/crypto';
import { DomainError } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { NotificationsService, mask } from '../notifications/notifications.service';
import { IdentityService, type UserRow, isEmail } from './identity.service';

const RECOVERY_CODES = 10;
/** The name authenticator apps show above the code. */
const TOTP_ISSUER = 'Bilete Afiliați';

/**
 * What every signed-in person can change about their own account, whatever their role: the
 * phone number and email they sign in with, two-step login, and signing out other devices.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identity: IdentityService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Tells the person on the phone and email they already had, so a stranger who got hold of an
   * open session cannot quietly add their own phone or turn two-step login off.
   */
  private async alert(
    user: Pick<UserRow, 'email' | 'phone'>,
    locale: string,
    event: 'contact_added' | 'two_factor_on' | 'two_factor_off' | 'two_factor_reset',
    contact?: string,
  ): Promise<void> {
    for (const to of [user.email, user.phone]) {
      if (!to) continue;
      await this.notifications.enqueue(this.db, {
        to,
        template: 'security_alert',
        locale,
        params: { event, contact, url: `${this.config.WEB_URL}/account` },
      });
    }
  }

  async security(userId: string): Promise<AccountSecurityDto> {
    const user = await this.identity.user(userId);
    return {
      email: user.email,
      phone: user.phone,
      twoFactorEnabled: user.totpEnabledAt !== null,
      twoFactorEnabledAt: user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: user.totpEnabledAt ? user.totpRecoveryHashes.length : 0,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Two-step login
  // ---------------------------------------------------------------------------------------------

  /** Starts (or restarts) the setup: a new secret to scan, not active until confirmed. */
  async startTwoFactor(userId: string): Promise<TwoFactorSetupDto> {
    const user = await this.identity.user(userId);
    if (user.totpEnabledAt) {
      throw new DomainError('errors.account.twoFactorAlreadyOn', HttpStatus.CONFLICT);
    }
    const secret = generateTotpSecret();
    await this.db
      .update(users)
      .set({ totpPendingSecret: sealSecret(this.config.APP_SECRET, secret) })
      .where(eq(users.id, userId));
    const account = user.email ?? user.phone ?? user.id;
    return { secret, otpauthUrl: totpUri(secret, TOTP_ISSUER, account) };
  }

  /**
   * The first code from the app confirms the setup. Every other device is signed out (whoever
   * had the account open elsewhere must now pass the second step); this one gets a new token.
   */
  async enableTwoFactor(userId: string, code: string, locale = 'en'): Promise<TwoFactorEnabledDto> {
    const user = await this.identity.user(userId);
    if (user.totpEnabledAt) {
      throw new DomainError('errors.account.twoFactorAlreadyOn', HttpStatus.CONFLICT);
    }
    if (!user.totpPendingSecret) {
      throw new DomainError('errors.account.twoFactorNoSetup', HttpStatus.CONFLICT);
    }
    const now = this.clock.now();
    const secret = openSecret(this.config.APP_SECRET, user.totpPendingSecret);
    const step = matchTotp(secret, code.replace(/\s/g, ''), now.getTime(), null);
    if (step === null) {
      throw new DomainError('errors.account.twoFactorWrongCode', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const recoveryCodes = this.newRecoveryCodes();
    const [updated] = await this.db
      .update(users)
      .set({
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: now,
        totpLastStep: step,
        totpFailedAttempts: 0,
        totpLockedUntil: null,
        totpRecoveryHashes: recoveryCodes.map((c) =>
          hashRecoveryCode(this.config.APP_SECRET, userId, c),
        ),
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId))
      .returning();
    await this.alert(user, locale, 'two_factor_on');
    return { recoveryCodes, token: this.identity.token(updated!) };
  }

  /** Turning it off needs a current code (or a recovery code), not only an open session. */
  async disableTwoFactor(userId: string, code: string, locale = 'en'): Promise<MeDto> {
    const user = await this.identity.user(userId);
    await this.identity.checkSecondFactor(user, code);
    await this.db
      .update(users)
      .set({
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryHashes: [],
        totpFailedAttempts: 0,
        totpLockedUntil: null,
      })
      .where(eq(users.id, userId));
    await this.alert(user, locale, 'two_factor_off');
    return this.identity.me(userId);
  }

  /** New recovery codes; the old ones stop working. */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<RecoveryCodesDto> {
    const user = await this.identity.user(userId);
    await this.identity.checkSecondFactor(user, code);
    const recoveryCodes = this.newRecoveryCodes();
    await this.db
      .update(users)
      .set({
        totpRecoveryHashes: recoveryCodes.map((c) =>
          hashRecoveryCode(this.config.APP_SECRET, userId, c),
        ),
      })
      .where(eq(users.id, userId));
    return { recoveryCodes };
  }

  private newRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODES }, () => generateRecoveryCode());
  }

  // ---------------------------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------------------------

  /** Signs the account out on every other phone and computer (a lost phone at the reception). */
  async signOutOtherDevices(userId: string): Promise<NewSessionTokenDto> {
    const [updated] = await this.db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    return { token: this.identity.token(updated) };
  }

  // ---------------------------------------------------------------------------------------------
  // Phone number and email
  // ---------------------------------------------------------------------------------------------

  /** Sends a code to the new phone number or email, to prove it belongs to this person. */
  async requestContactChange(userId: string, destination: string, locale: string): Promise<void> {
    await this.assertContactFree(userId, destination);
    await this.identity.requestOtp(destination, locale);
  }

  /** With the code from the new phone or inbox, it becomes a way to sign in to this account. */
  async confirmContactChange(
    userId: string,
    destination: string,
    code: string,
    locale = 'en',
  ): Promise<MeDto> {
    const before = await this.identity.user(userId);
    await this.assertContactFree(userId, destination);
    await this.identity.consumeOtp(destination, code);
    const change = isEmail(destination) ? { email: destination } : { phone: destination };
    try {
      await this.db.update(users).set(change).where(eq(users.id, userId));
    } catch (error) {
      // Taken by someone else in the meantime (unique index).
      if ((error as { code?: string }).code === '23505') {
        throw new DomainError('errors.account.contactTaken', HttpStatus.CONFLICT);
      }
      throw error;
    }
    if (destination !== before.email && destination !== before.phone) {
      await this.alert(before, locale, 'contact_added', mask(destination));
    }
    return this.identity.me(userId);
  }

  private async assertContactFree(userId: string, destination: string): Promise<void> {
    const column = isEmail(destination) ? users.email : users.phone;
    const [other] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(column, destination), ne(users.id, userId)));
    if (other) throw new DomainError('errors.account.contactTaken', HttpStatus.CONFLICT);
  }

  // ---------------------------------------------------------------------------------------------
  // Platform admin support
  // ---------------------------------------------------------------------------------------------

  /** The account that signs in with this phone number or email, if there is one. */
  async findForAdmin(contact: string): Promise<AdminAccountDto | null> {
    const column = isEmail(contact) ? users.email : users.phone;
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(column, contact));
    return user ? this.adminView(user.id) : null;
  }

  /**
   * For someone who lost both the phone with the authenticator app and the recovery codes. The
   * person is told on their phone and email, so a stranger who talked support into it is noticed.
   */
  async resetTwoFactorForAdmin(
    adminId: string,
    userId: string,
    fallbackLocale = 'en',
  ): Promise<AdminAccountDto> {
    const user = await this.adminTarget(userId);
    await this.db
      .update(users)
      .set({
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        totpRecoveryHashes: [],
        totpFailedAttempts: 0,
        totpLockedUntil: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, userId));
    await this.audit(adminId, userId, 'two_factor_reset', { wasOn: user.totpEnabledAt !== null });
    await this.alert(user, await this.localeOf(userId, fallbackLocale), 'two_factor_reset');
    return this.adminView(userId);
  }

  /** Signs the account out on every device (a lost phone, a person who left). */
  async signOutForAdmin(adminId: string, userId: string): Promise<AdminAccountDto> {
    await this.adminTarget(userId);
    await this.db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId));
    await this.audit(adminId, userId, 'signed_out_everywhere', {});
    return this.adminView(userId);
  }

  private async adminTarget(userId: string): Promise<UserRow> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new DomainError('errors.notFound.user', HttpStatus.NOT_FOUND);
    return user;
  }

  private async adminView(userId: string): Promise<AdminAccountDto> {
    const user = await this.adminTarget(userId);
    const rows = await this.db
      .select({ tenantId: tenants.id, tenantName: tenants.name, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(tenants.name);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      isPlatformAdmin: isPlatformAdmin(this.config, user),
      twoFactorEnabled: user.totpEnabledAt !== null,
      twoFactorEnabledAt: user.totpEnabledAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      memberships: rows,
    };
  }

  /** The language of the person's first operator, for messages sent without their request. */
  private async localeOf(userId: string, fallback: string): Promise<string> {
    const [row] = await this.db
      .select({ locale: tenants.defaultLocale })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(memberships.createdAt)
      .limit(1);
    return row?.locale ?? fallback;
  }

  private async audit(
    adminId: string,
    userId: string,
    action: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert(auditLog).values({
      tenantId: null,
      actorUserId: adminId,
      action,
      entityType: 'user',
      entityId: userId,
      data,
    });
  }
}
