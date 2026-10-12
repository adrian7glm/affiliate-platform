import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { AppRequest } from '../common/auth';
import { DomainError } from '../common/errors';

/** Only the platform owner's accounts. Use after AuthGuard. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new DomainError('errors.auth.signInAgain', HttpStatus.UNAUTHORIZED);
    if (!user.isPlatformAdmin) throw new DomainError('errors.auth.forbidden', HttpStatus.FORBIDDEN);
    return true;
  }
}
