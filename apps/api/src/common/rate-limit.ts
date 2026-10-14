import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { DomainError } from './errors';

export interface RateLimitRule {
  /** Requests allowed per client IP in one window. */
  limit: number;
  windowMs: number;
}

const RATE_LIMIT_KEY = 'rate-limit';

/**
 * Caps how often one client IP may call a route. For the public routes that cost money or
 * resources: login codes (each one is an SMS), checkouts (each one holds seats).
 * Use with `@UseGuards(RateLimitGuard)`.
 */
export const RateLimit = (bucket: string, rule: RateLimitRule) =>
  SetMetadata(RATE_LIMIT_KEY, { bucket, ...rule });

interface Window {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed windows, per API process. With several API instances each one counts on its
 * own, so the effective limit is the limit times the number of instances.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweep = 0;

  /** Counts one hit; returns the seconds to wait when the limit is exceeded, else null. */
  hit(key: string, rule: RateLimitRule, now = Date.now()): number | null {
    this.sweep(now);
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + rule.windowMs });
      return null;
    }
    current.count += 1;
    if (current.count <= rule.limit) return null;
    return Math.ceil((current.resetAt - now) / 1000);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.RATE_LIMITS) return true;
    const rule = this.reflector.getAllAndOverride<(RateLimitRule & { bucket: string }) | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rule) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const retryAfter = this.limiter.hit(`${rule.bucket}:${ip}`, rule);
    if (retryAfter === null) return true;
    http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    throw new DomainError('errors.limits.tooManyRequests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
