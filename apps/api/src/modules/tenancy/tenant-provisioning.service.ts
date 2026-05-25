import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const VALID_SCHEMA_RE = /^tenant_[a-z0-9_]{1,48}$/;
const TEMPLATE_PLACEHOLDER = '{{schema}}';

/**
 * Encapsulates the tenant-schema lifecycle. Phase A scaffolded the empty
 * `tenant_meta` table; Phase B.1 layers the clinical foundation on top —
 * patients, encounters, appointments, schedules, resources — provisioned
 * from the canonical `prisma/tenant-template.sql` DDL.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private cachedTemplateSql: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  static toSchemaName(slug: string): string {
    const sanitized = slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48);
    return `tenant_${sanitized || 'default'}`;
  }

  /**
   * Install database-wide extensions required by the per-tenant DDL. Safe to
   * call multiple times. Must run before `provisionSchema` for any tenant.
   */
  async ensureDatabaseExtensions(): Promise<void> {
    // btree_gist is required for the no-overlap exclusion constraint on
    // appointments. gen_random_uuid is built-in since Postgres 13.
    await this.prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
  }

  async provisionSchema(schemaName: string): Promise<void> {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Refusing to provision invalid schema name: ${schemaName}`);
    }
    const ident = Prisma.raw(`"${schemaName}"`);
    await this.ensureDatabaseExtensions();
    await this.prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS ${ident}`;
    await this.prisma.$executeRaw`CREATE TABLE IF NOT EXISTS ${ident}.tenant_meta (
      id BIGSERIAL PRIMARY KEY,
      provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      schema_version INTEGER NOT NULL DEFAULT 1
    )`;
    await this.applyTenantTemplate(schemaName);
    this.logger.log(`Provisioned tenant schema ${schemaName}`);
  }

  /**
   * Re-applies the canonical tenant DDL against an existing schema. Idempotent
   * (all statements are `IF NOT EXISTS`). Used by Phase B.1 to backfill the
   * clinical tables onto demo tenants provisioned during Phase A.
   */
  async applyTenantTemplate(schemaName: string): Promise<void> {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Refusing to apply template to invalid schema name: ${schemaName}`);
    }
    const sql = await this.loadTemplateSql();
    const rendered = sql.replaceAll(TEMPLATE_PLACEHOLDER, `"${schemaName}"`);
    // Statements in the template are separated by blank lines and run
    // independently via $executeRawUnsafe so DDL inside a single statement
    // (with embedded semicolons in CHECK expressions, etc.) is preserved.
    const statements = splitStatements(rendered);
    for (const stmt of statements) {
      await this.prisma.$executeRawUnsafe(stmt);
    }
  }

  async dropSchema(schemaName: string): Promise<void> {
    if (!VALID_SCHEMA_RE.test(schemaName)) {
      throw new Error(`Refusing to drop invalid schema name: ${schemaName}`);
    }
    const ident = Prisma.raw(`"${schemaName}"`);
    await this.prisma.$executeRaw`DROP SCHEMA IF EXISTS ${ident} CASCADE`;
    this.logger.warn(`Dropped tenant schema ${schemaName}`);
  }

  private async loadTemplateSql(): Promise<string> {
    if (this.cachedTemplateSql) return this.cachedTemplateSql;
    // The compiled JS lives at dist/modules/tenancy/...; the SQL ships under
    // prisma/. Walk up to the api app root so this works in both dev (ts-node
    // via __dirname=apps/api/src/...) and prod (dist/...).
    const apiRoot = findApiRoot(__dirname);
    const path = join(apiRoot, 'prisma', 'tenant-template.sql');
    this.cachedTemplateSql = await readFile(path, 'utf8');
    return this.cachedTemplateSql;
  }
}

/**
 * Split a SQL script on bare semicolons that terminate top-level statements.
 * Handles single-quoted strings, double-quoted identifiers, and line/block
 * comments. The trailing statement may omit its terminator.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? '';
    const n = sql[i + 1] ?? '';
    if (inLineComment) {
      buf += c;
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      buf += c;
      if (c === '*' && n === '/') {
        buf += n;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && n === "'") {
        buf += n;
        i++;
        continue;
      }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      buf += c;
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === '-' && n === '-') {
      buf += c;
      inLineComment = true;
      continue;
    }
    if (c === '/' && n === '*') {
      buf += c;
      inBlockComment = true;
      continue;
    }
    if (c === "'") {
      buf += c;
      inSingle = true;
      continue;
    }
    if (c === '"') {
      buf += c;
      inDouble = true;
      continue;
    }
    if (c === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) out.push(trimmed);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

function findApiRoot(start: string): string {
  // Walk up until we find package.json with name `@quantumed/api`.
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (dir.endsWith('/apps/api') || dir.endsWith('\\apps\\api')) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume the typical layout. The seed/test paths exercise this.
  return join(__dirname, '..', '..', '..');
}
