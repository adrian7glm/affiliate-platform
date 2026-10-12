import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AppRequest } from '../common/auth';

/** Only the platform owner's accounts. Use after AuthGuard. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new UnauthorizedException('sign in again');
    if (!user.isPlatformAdmin) throw new ForbiddenException('you do not have access to this');
    return true;
  }
}
