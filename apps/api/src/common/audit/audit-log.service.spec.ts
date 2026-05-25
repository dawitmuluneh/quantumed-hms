import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AuditLogService, canonicalStringify, type AuditWriteInput } from './audit-log.service';

/**
 * Minimal in-memory Prisma double for the audit log. We only stub the
 * surfaces the service uses (`$transaction`, `$queryRaw`, `auditLog.create`,
 * `auditLog.findMany`) so the spec stays focused on the chain invariants
 * without spinning up Postgres.
 */
class FakePrisma {
  rows: Array<{
    id: number;
    prevHash: string | null;
    hash: string;
    action: string;
    resource: string;
    resourceId: string | null;
    actorUserId: string | null;
    hospitalId: string | null;
    outcome: 'SUCCESS' | 'FAILURE';
    payload: Record<string, unknown> | null;
  }> = [];
  nextId = 1;

  /** Force `$transaction` to throw a P2034 the first `count` calls. */
  serializationFailuresRemaining = 0;

  async $transaction<T>(
    fn: (tx: FakePrisma) => Promise<T>,
    _opts: { isolationLevel: unknown },
  ): Promise<T> {
    if (this.serializationFailuresRemaining > 0) {
      this.serializationFailuresRemaining--;
      throw new Prisma.PrismaClientKnownRequestError(
        'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
        { code: 'P2034', clientVersion: 'test' },
      );
    }
    return fn(this);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async $queryRaw<T>(_query: unknown): Promise<T> {
    const tip = this.rows.at(-1);
    return (tip ? [{ hash: tip.hash }] : []) as unknown as T;
  }

  auditLog = {
    create: async ({ data }: { data: Omit<FakePrisma['rows'][number], 'id'> }) => {
      this.rows.push({ id: this.nextId++, ...data });
    },
    findMany: async ({ orderBy: _o, take: _t, select: _s }: Record<string, unknown>) => {
      // Simulate Postgres JSONB key-reorder: re-sort payload keys alphabetically
      // on read. This is the actual production behaviour we discovered during
      // Phase A smoke testing.
      return this.rows.map((row) => ({
        ...row,
        payload: row.payload ? reorderKeysAlphabetically(row.payload) : null,
      }));
    },
  };
}

function reorderKeysAlphabetically(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function makeService(prisma: FakePrisma): AuditLogService {
  const config = {
    get: (key: string) => (key === 'AUDIT_HASH_PEPPER' ? 'test-pepper' : undefined),
  } as unknown as ConfigService;
  return new AuditLogService(prisma as unknown as PrismaService, config);
}

describe('AuditLogService', () => {
  describe('canonicalStringify', () => {
    it('produces identical output regardless of key insertion order', () => {
      const a = canonicalStringify({ reason: 'x', email: 'a@b.c' });
      const b = canonicalStringify({ email: 'a@b.c', reason: 'x' });
      expect(a).toBe(b);
    });

    it('sorts nested object keys recursively', () => {
      const a = canonicalStringify({ outer: { z: 1, a: 2 }, alpha: 1 });
      const b = canonicalStringify({ alpha: 1, outer: { a: 2, z: 1 } });
      expect(a).toBe(b);
      expect(a).toBe('{"alpha":1,"outer":{"a":2,"z":1}}');
    });

    it('preserves array order', () => {
      expect(canonicalStringify({ xs: [3, 1, 2] })).toBe('{"xs":[3,1,2]}');
    });
  });

  describe('hash chain', () => {
    it('round-trips: verifyChain succeeds after multi-key payload writes', async () => {
      const prisma = new FakePrisma();
      const svc = makeService(prisma);

      // Write three rows whose payloads have keys in a deliberately
      // non-alphabetical order — Postgres JSONB will reorder them on read.
      await svc.write({
        action: 'auth.login',
        resource: 'user',
        outcome: 'FAILURE',
        payload: { reason: 'unknown_email', email: 'a@demo.com' },
      });
      await svc.write({
        action: 'auth.login',
        resource: 'user',
        outcome: 'FAILURE',
        payload: { reason: 'wrong_password', email: 'b@demo.com' },
      });
      await svc.write({
        action: 'auth.logout',
        resource: 'user',
        actorUserId: 'user-1',
        hospitalId: 'hospital-1',
        payload: { familyId: 'fam-1' },
      });

      await expect(svc.verifyChain(1000)).resolves.toBe(true);
    });

    it('detects tampering: mutating a stored hash breaks the chain', async () => {
      const prisma = new FakePrisma();
      const svc = makeService(prisma);

      await svc.write({ action: 'a', resource: 'r', payload: { x: 1 } });
      await svc.write({ action: 'b', resource: 'r', payload: { y: 2 } });

      // Tamper with the first row's hash.
      const first = prisma.rows[0];
      if (!first) throw new Error('expected a row to tamper with');
      first.hash = createHash('sha256').update('tampered').digest('hex');

      await expect(svc.verifyChain(1000)).resolves.toBe(false);
    });
  });

  describe('serialization-conflict retry', () => {
    it('retries on P2034 and eventually persists the row', async () => {
      const prisma = new FakePrisma();
      // Fail twice, succeed on third attempt.
      prisma.serializationFailuresRemaining = 2;
      const svc = makeService(prisma);

      await svc.write({ action: 'auth.login', resource: 'user', payload: { x: 1 } });

      expect(prisma.rows).toHaveLength(1);
      expect(prisma.serializationFailuresRemaining).toBe(0);
    });

    it('gives up after MAX_RETRY_ATTEMPTS and does not throw', async () => {
      const prisma = new FakePrisma();
      // Fail more times than the service will retry.
      prisma.serializationFailuresRemaining = 10;
      const svc = makeService(prisma);

      const loggerSpy = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn((svc as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(svc.write({ action: 'auth.login', resource: 'user' })).resolves.toBeUndefined();
      expect(prisma.rows).toHaveLength(0);
      expect(loggerSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-serialization errors', async () => {
      const prisma = new FakePrisma();
      const svc = makeService(prisma);

      jest.spyOn(prisma, '$transaction').mockRejectedValue(new Error('database is on fire'));
      const loggerSpy = jest
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .spyOn((svc as any).logger, 'error')
        .mockImplementation(() => undefined);

      await svc.write({ action: 'auth.login', resource: 'user' });

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('canonicalization under JSONB reorder', () => {
    it('hash is stable when the only difference is JSONB key order', async () => {
      const prisma = new FakePrisma();
      const svc = makeService(prisma);
      const input: AuditWriteInput = {
        action: 'auth.login',
        resource: 'user',
        payload: { z: 1, a: 2, m: { k: 3, b: 4 } },
      };

      await svc.write(input);
      const firstWrite = prisma.rows[0];
      if (!firstWrite) throw new Error('first write did not persist');
      const stored = firstWrite.hash;

      // Drop and re-write with the same payload but rearranged keys; should
      // produce the same hash.
      prisma.rows = [];
      prisma.nextId = 1;
      await svc.write({
        ...input,
        payload: { a: 2, m: { b: 4, k: 3 }, z: 1 },
      });
      const secondWrite = prisma.rows[0];
      if (!secondWrite) throw new Error('second write did not persist');
      expect(secondWrite.hash).toBe(stored);
    });
  });
});
