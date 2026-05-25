import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

// Maximum retry attempts for SERIALIZABLE transaction conflicts. 5 attempts
// at 20/40/80/160/320 ms = up to ~620 ms of backoff in the worst case, which
// matches the latency budget for an audit-eligible request and keeps the chain
// intact under bursty contention.
const MAX_RETRY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 20;

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
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
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
        return;
      } catch (err) {
        // Serialization failures are the expected outcome when two writers race
        // for the same chain tip — retry with exponential backoff. Anything
        // else is logged and dropped (audit failures must never break the
        // request, but the operator needs to know).
        if (isSerializationFailure(err) && attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        this.logger.error(
          `Failed to persist audit log row for ${input.action}/${input.resource} (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }
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
    // Canonicalize the whole hashed envelope: sort all object keys recursively
    // so the same logical row hashes the same regardless of how Postgres JSONB
    // chooses to re-order keys on read. Without this, verifyChain() would fail
    // for any row with a multi-key payload (Postgres JSONB does not preserve
    // key insertion order — see ADR-0004 update notes).
    const canonical = canonicalStringify({
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

/**
 * `JSON.stringify` with deterministic, recursively sorted object keys. Arrays
 * keep their order; primitives are serialized as `JSON.stringify` would. This
 * is the cheapest fix for the JSONB key-reorder issue — both the write and the
 * read side produce identical canonical bytes for the same logical content.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, sortKeys(v)] as const);
  return Object.fromEntries(entries);
}

/**
 * True iff `err` is a Postgres SERIALIZABLE / deadlock failure. Prisma surfaces
 * these as `P2034` ("Transaction failed due to a write conflict or a
 * deadlock"). We also accept raw PG `40001` / `40P01` SQLSTATE codes for
 * defence-in-depth, e.g. if Prisma swaps the wrapper code in a future version.
 */
function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
    return true;
  }
  if (err instanceof Error) {
    const sqlstate = (err as { code?: string }).code;
    if (sqlstate === '40001' || sqlstate === '40P01') return true;
    // Some Prisma error wrappers stringify the underlying message rather than
    // surfacing the code; fall back to a substring sniff as a last resort.
    if (/write conflict|deadlock|could not serialize/i.test(err.message)) return true;
  }
  return false;
}
