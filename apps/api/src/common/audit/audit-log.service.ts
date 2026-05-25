import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface AuditWriteInput {
  hospitalId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE';
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Append-only audit log with SHA-256 hash chaining. Each row's hash covers the
 * previous row's hash plus the current row's content (peppered with
 * `AUDIT_HASH_PEPPER`). Tamper-evidence: rewriting any historical row breaks
 * the chain at every subsequent row.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);
  private readonly pepper: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.pepper = this.config.get<string>('AUDIT_HASH_PEPPER') ?? 'dev-pepper';
  }

  async write(input: AuditWriteInput): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // SELECT ... FOR UPDATE on the tip of the chain so concurrent writers
          // serialize behind us. SERIALIZABLE on its own is not enough because
          // the predecessor row is not modified — only read — so two readers
          // would both see the same prev hash and insert siblings. ADR-0004.
          const last = await tx.$queryRaw<Array<{ hash: string }>>(
            Prisma.sql`SELECT hash FROM platform.audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          );
          const prevHash = last[0]?.hash ?? null;
          const hash = this.computeHash(prevHash, input);
          await tx.auditLog.create({
            data: {
              hospitalId: input.hospitalId ?? null,
              actorUserId: input.actorUserId ?? null,
              actorRole: input.actorRole ?? null,
              action: input.action,
              resource: input.resource,
              resourceId: input.resourceId ?? null,
              outcome: input.outcome ?? 'SUCCESS',
              ipAddress: input.ipAddress ?? null,
              userAgent: input.userAgent ?? null,
              requestId: input.requestId ?? null,
              payload: (input.payload as object | null) ?? undefined,
              prevHash,
              hash,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // Audit logging must never break the request, but failures are critical.
      this.logger.error(
        `Failed to persist audit log row for ${input.action}/${input.resource}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Recompute and verify the chain. Returns true if intact; false otherwise.
   */
  async verifyChain(limit = 1000): Promise<boolean> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { id: 'asc' },
      take: limit,
      select: {
        prevHash: true,
        hash: true,
        action: true,
        resource: true,
        resourceId: true,
        actorUserId: true,
        hospitalId: true,
        outcome: true,
        payload: true,
        createdAt: true,
      },
    });
    let prev: string | null = null;
    for (const row of rows) {
      if (row.prevHash !== prev) return false;
      const expected = this.computeHash(prev, {
        hospitalId: row.hospitalId,
        actorUserId: row.actorUserId,
        action: row.action,
        resource: row.resource,
        resourceId: row.resourceId,
        outcome: row.outcome,
        payload: (row.payload as Record<string, unknown> | null) ?? null,
      });
      if (row.hash !== expected) return false;
      prev = row.hash;
    }
    return true;
  }

  private computeHash(prevHash: string | null, input: AuditWriteInput): string {
    const canonical = JSON.stringify({
      hospitalId: input.hospitalId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      payload: input.payload ?? null,
    });
    return createHash('sha256')
      .update(this.pepper)
      .update('\x1f')
      .update(prevHash ?? '')
      .update('\x1f')
      .update(canonical)
      .digest('hex');
  }
}
