import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { UnauthorizedError } from '../errors/domain-error';

export interface AuthenticatedUser {
  userId: string;
  hospitalId: string | null;
  roles: string[];
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) throw new UnauthorizedError('No authenticated user on request');
    return req.user;
  },
);
