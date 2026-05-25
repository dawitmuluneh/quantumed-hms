import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'quantumed:isPublic';

/**
 * Opt-out of the global AuthGuard. Apply to login/register/health endpoints
 * and any marketing API surface that must be reachable without authentication.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
