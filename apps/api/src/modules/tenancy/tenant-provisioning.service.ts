import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const VALID_SCHEMA_RE = /^tenant_[a-z0-9_]{1,48}$/;

/**
 * Encapsulates the tenant-schema lifecycle. Today (Phase A) the per-tenant
 * schemas only host placeholder objects so we can prove the isolation pattern
 * end-to-end; in Phase B the clinical entities migrate from the platform
 * schema into here.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  static toSchemaName(slug: string): string {
    const sanitized = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    return `tenant_${sanitized || 'default'}`;
  }

  async provisionSchema(schemaName: string): Promise<void> {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Refusing to provision invalid schema name: ${schemaName}`);
    }
    const ident = Prisma.raw(`"${schemaName}"`);
    await this.prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS ${ident}`;
    await this.prisma.$executeRaw`CREATE TABLE IF NOT EXISTS ${ident}.tenant_meta (
      id BIGSERIAL PRIMARY KEY,
      provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      schema_version INTEGER NOT NULL DEFAULT 1
    )`;
    this.logger.log(`Provisioned tenant schema ${schemaName}`);
  }

  async dropSchema(schemaName: string): Promise<void> {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Refusing to drop invalid schema name: ${schemaName}`);
    }
    const ident = Prisma.raw(`"${schemaName}"`);
    await this.prisma.$executeRaw`DROP SCHEMA IF EXISTS ${ident} CASCADE`;
    this.logger.warn(`Dropped tenant schema ${schemaName}`);
  }
}
