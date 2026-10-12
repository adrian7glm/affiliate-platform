import {
  type CanActivate,
  createParamDecorator,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@ap/contracts';
import { type Database, affiliates, memberships, tenants, users } from '@ap/db';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { DB } from '../database/database.module';
import { verifySession } from './crypto';
import { DomainError } from './errors';

export interface AuthUser {
  id: string;
  isPlatformAdmin: boolean;
}

/** The tenant a request acts in, resolved from the X-Tenant-Id header and the user's memberships. */
export interface TenantContext {
  tenantId: string;
  roles: Role[];
  /** Set when the user is an affiliate of this tenant. */
  affiliateId: string | null;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? verifySession(this.config.APP_SECRET, token) : null;
    if (!claims) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    const [user] = await this.db
      .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, claims.sub));
    if (!user) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    request.user = user;
    return true;
  }
}

const ROLES_KEY = 'roles';
/** Restricts a controller or route to users with one of these roles in the current tenant. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const user = request.user;
    if (!user) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    const tenantId = String(request.headers['x-tenant-id'] ?? '');
    if (!UUID.test(tenantId))
      throw new DomainError('errors.auth.chooseOperatorHeader', HttpStatus.FORBIDDEN);

    const rows = await this.db
      .select({ role: memberships.role, tenantStatus: tenants.status })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.tenantId, tenantId)));
    const roles = rows.map((r) => r.role);
    if (rows[0]?.tenantStatus === 'suspended') {
      throw new DomainError('errors.auth.operatorSuspended', HttpStatus.FORBIDDEN);
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !required.some((role) => roles.includes(role))) {
      throw new DomainError('errors.auth.forbidden', HttpStatus.FORBIDDEN);
    }

    let affiliateId: string | null = null;
    if (roles.includes('affiliate')) {
      const [affiliate] = await this.db
        .select({ id: affiliates.id, status: affiliates.status })
        .from(affiliates)
        .where(and(eq(affiliates.tenantId, tenantId), eq(affiliates.userId, user.id)));
      if (
        affiliate?.status === 'suspended' &&
        required?.length === 1 &&
        required[0] === 'affiliate'
      ) {
        throw new DomainError('errors.auth.affiliateSuspended', HttpStatus.FORBIDDEN);
      }
      affiliateId = affiliate?.id ?? null;
    }
    request.tenant = { tenantId, roles, affiliateId };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    return user;
  },
);

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const tenant = context.switchToHttp().getRequest<AppRequest>().tenant;
    if (!tenant) throw new DomainError('errors.auth.chooseOperator', HttpStatus.FORBIDDEN);
    return tenant;
  },
);

/** For affiliate routes: the affiliate id of the signed-in user in the current tenant. */
export const CurrentAffiliate = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const tenant = context.switchToHttp().getRequest<AppRequest>().tenant;
    if (!tenant?.affiliateId)
      throw new DomainError('errors.auth.notAffiliate', HttpStatus.FORBIDDEN);
    return tenant.affiliateId;
  },
);
