import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthContext } from '../decorators/current-user.decorator';
import { Role as RoleEnum, Permission } from '@prolific/shared-types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthContext | undefined;

    if (!user) {
      throw new ForbiddenException('No authenticated context');
    }

    if (user.role === RoleEnum.SUPER_ADMIN) return true;

    const hasAll = required.every((p) => user.permissions?.includes(p));
    if (!hasAll) {
      this.logger.warn(
        `Permission denied for user=${user.userId} role=${user.role} missing=${required.filter(
          (p) => !user.permissions?.includes(p)
        )}`
      );
      throw new ForbiddenException(
        'You do not have permission to perform this action'
      );
    }
    return true;
  }
}
