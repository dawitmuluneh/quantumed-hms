import { SetMetadata } from '@nestjs/common';
import type { Action, Resource } from '@quantumed/shared-types';

export const REQUIRE_PERMISSION_KEY = 'quantumed:requirePermission';

export interface PermissionSpec {
  resource: Resource;
  action: Action;
}

/**
 * Declares the permission required to access the decorated controller route.
 * The global RbacGuard reads this metadata and consults the canonical matrix.
 */
export const RequirePermission = (
  resource: Resource,
  action: Action,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { resource, action } satisfies PermissionSpec);
