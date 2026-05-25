import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ForbiddenError } from '../errors/domain-error';

import { SKIP_TENANT_KEY } from './skip-tenant.decorator';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class RequireTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const ctx = this.tenant.getTenantOrNull();
    if (!ctx) {
      throw new ForbiddenError('Tenant context is required for this route', 'TENANT_REQUIRED');
    }
    return true;
  }
}
