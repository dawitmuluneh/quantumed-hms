import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Action, Resource } from '@quantumed/shared-types';

import { ForbiddenError, UnauthorizedError } from '../errors/domain-error';

import { isPermitted } from './permissions.matrix';
import { PermissionSpec, REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

interface AuthenticatedRequest {
  user?: { userId: string; roles: string[]; hospitalId: string | null };
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<PermissionSpec | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!spec) return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) throw new UnauthorizedError('Authentication required for this route');
    if (!isPermitted(user.roles, spec.resource as Resource, spec.action as Action)) {
      throw new ForbiddenError(
        `Missing permission ${spec.action}:${spec.resource}`,
        'PERMISSION_DENIED',
      );
    }
    return true;
  }
}
