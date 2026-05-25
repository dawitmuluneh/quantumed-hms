import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves tenant context from `X-Tenant-Id` header or the first subdomain
 * label (e.g. `acme.quantumed.health`). Resolution failure does NOT fail the
 * request here — the `RequireTenantGuard` enforces presence on the routes
 * that need it. Unauthenticated routes (login, marketing, health) can run
 * without tenant context.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const id = this.resolveTenantId(req);
      if (!id) return next();
      const hospital = await this.prisma.hospital.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        select: { id: true, schemaName: true, isolationMode: true, tier: true, status: true },
      });
      if (hospital && hospital.status === 'ACTIVE') {
        this.cls.set('tenant', {
          hospitalId: hospital.id,
          schemaName: hospital.schemaName,
          isolationMode: hospital.isolationMode,
          tier: hospital.tier,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to resolve tenant context: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    next();
  }

  private resolveTenantId(req: Request): string | null {
    const header = req.headers['x-tenant-id'];
    if (typeof header === 'string' && header.trim().length > 0) return header.trim();
    const host = req.headers.host ?? '';
    const firstLabel = host.split(':')[0]?.split('.')[0];
    if (firstLabel && firstLabel !== 'localhost' && firstLabel !== 'www' && firstLabel !== 'api') {
      return firstLabel;
    }
    return null;
  }
}
