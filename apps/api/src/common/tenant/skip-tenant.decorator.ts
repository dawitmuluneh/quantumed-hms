import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'quantumed:skipTenant';

/**
 * Opt-out of tenant context enforcement for a specific route or controller.
 * Use sparingly — auth/login, health checks, marketing pages, and Super Admin
 * endpoints are the only legitimate uses.
 */
export const SkipTenant = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_TENANT_KEY, true);
