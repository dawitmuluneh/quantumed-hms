import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

/**
 * Global authentication guard. Default behaviour: require a valid JWT for
 * every route. Opt-out per route with `@Public()`.
 */
@Injectable()
export class AuthGuard extends PassportAuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
