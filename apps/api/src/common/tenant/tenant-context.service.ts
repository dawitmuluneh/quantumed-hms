import { Injectable } from '@nestjs/common';
import type { HospitalTier, IsolationMode } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

export interface TenantContext {
  hospitalId: string;
  schemaName: string;
  isolationMode: IsolationMode;
  tier: HospitalTier;
}

const TENANT_KEY = 'tenant';
const USER_KEY = 'user';

export interface RequestUserContext {
  userId: string;
  hospitalId: string | null;
  roles: string[];
}

/**
 * Tenant context propagation via AsyncLocalStorage (nestjs-cls). Every
 * tenant-scoped controller pulls the context from here instead of relying on a
 * request param, which eliminates leak-across-async bugs.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService) {}

  setTenant(ctx: TenantContext): void {
    this.cls.set(TENANT_KEY, ctx);
  }

  getTenantOrNull(): TenantContext | null {
    return this.cls.get<TenantContext | undefined>(TENANT_KEY) ?? null;
  }

  getTenant(): TenantContext {
    const ctx = this.getTenantOrNull();
    if (!ctx) {
      throw new Error('Tenant context is required but missing on this request');
    }
    return ctx;
  }

  setUser(ctx: RequestUserContext): void {
    this.cls.set(USER_KEY, ctx);
  }

  getUserOrNull(): RequestUserContext | null {
    return this.cls.get<RequestUserContext | undefined>(USER_KEY) ?? null;
  }
}
