import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { PatientsService } from './patients.service';

interface MockPrismaCall {
  sql: string;
  values: unknown[];
}

class MockPrisma {
  public calls: MockPrismaCall[] = [];
  // The responses queue is consumed in FIFO order by $queryRaw.
  public responses: unknown[][] = [];

  $queryRaw = jest.fn((query: { sql?: string; values?: unknown[] }) => {
    // Prisma.sql template returns an object with `sql` and `values`.
    this.calls.push({ sql: query.sql ?? '', values: query.values ?? [] });
    const next = this.responses.shift() ?? [];
    return Promise.resolve(next);
  });
}

const tenantCtx = {
  hospitalId: 'hospital-1',
  schemaName: 'tenant_demo',
  isolationMode: 'SCHEMA' as const,
  tier: 'STANDARD' as const,
};

const mockTenant = {
  getTenant: () => tenantCtx,
  getTenantOrNull: () => tenantCtx,
  setTenant: jest.fn(),
  setUser: jest.fn(),
  getUserOrNull: () => null,
} as unknown as ConstructorParameters<typeof PatientsService>[1];

const mockEncryption = {
  encrypt: jest.fn((_tenant: string, plaintext: string) => Promise.resolve(`enc:${plaintext}`)),
  decrypt: jest.fn((_tenant: string, payload: string) =>
    Promise.resolve(payload.startsWith('enc:') ? payload.slice(4) : payload),
  ),
} as unknown as ConstructorParameters<typeof PatientsService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof PatientsService>[3];

const baseInput = {
  firstName: 'Alice',
  lastName: 'Doe',
  dob: '1990-01-15',
  sex: 'F' as const,
  phone: '+1-555-0100',
  email: 'alice@example.com',
};

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  mrn: 'P-ABCDEFGH',
  first_name_enc: 'enc:Alice',
  last_name_enc: 'enc:Doe',
  dob_enc: 'enc:1990-01-15',
  sex: 'F',
  phone_enc: 'enc:+1-555-0100',
  email_enc: 'enc:alice@example.com',
  address_enc: null,
  preferred_language: 'en',
  portal_user_id: null,
  status: 'ACTIVE',
  registered_at: new Date('2025-01-01T00:00:00Z'),
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('PatientsService', () => {
  let prisma: MockPrisma;
  let svc: PatientsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new PatientsService(
      prisma as unknown as ConstructorParameters<typeof PatientsService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('register', () => {
    it('encrypts PHI, persists the row, and writes an audit entry', async () => {
      prisma.responses.push([]); // MRN uniqueness check (none)
      prisma.responses.push([dbRow()]); // INSERT RETURNING *

      const result = await svc.register(baseInput, 'actor-1');

      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'Alice');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'Doe');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', '1990-01-15');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', '+1-555-0100');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'alice@example.com');

      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          hospitalId: 'hospital-1',
          actorUserId: 'actor-1',
          action: 'patient.register',
          resource: 'patient',
          outcome: 'SUCCESS',
        }),
      );

      // Round-trip: decrypted view exposes plaintext to the controller.
      expect(result.firstName).toBe('Alice');
      expect(result.email).toBe('alice@example.com');
      expect(result.phone).toBe('+1-555-0100');
      expect(result.mrn).toBe('P-ABCDEFGH');
    });

    it('rejects a duplicate MRN with ConflictError without writing audit', async () => {
      prisma.responses.push([{ id: 'existing' }]); // existing MRN row

      await expect(svc.register({ ...baseInput, mrn: 'M-0001' }, 'actor-1')).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(mockAudit.write).not.toHaveBeenCalled();
    });

    it('generates an MRN matching the P-XXXXXXXX format when none is supplied', async () => {
      prisma.responses.push([]); // no existing MRN
      prisma.responses.push([dbRow({ mrn: 'P-DEADBEEF' })]);
      const result = await svc.register(baseInput, 'actor-1');
      expect(result.mrn).toMatch(/^P-[0-9A-F]{8}$/);
    });
  });

  describe('findById', () => {
    it('decrypts PHI on read', async () => {
      prisma.responses.push([dbRow()]);
      const p = await svc.findById('00000000-0000-0000-0000-000000000001');
      expect(p.firstName).toBe('Alice');
      expect(p.lastName).toBe('Doe');
      expect(mockEncryption.decrypt).toHaveBeenCalled();
    });

    it('throws NotFoundError when the row is missing', async () => {
      prisma.responses.push([]);
      await expect(svc.findById('nope')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('list', () => {
    it('returns a page of decrypted patients with paging metadata', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        dbRow({
          id: `00000000-0000-0000-0000-00000000000${i + 1}`,
          mrn: `P-XX00000${i}`,
        }),
      );
      prisma.responses.push(rows);
      const out = await svc.list({ pageSize: 50 });
      expect(out.data).toHaveLength(3);
      expect(out.meta.hasMore).toBe(false);
      expect(out.meta.nextCursor).toBeNull();
    });

    it('produces a non-null cursor when there is a next page', async () => {
      // Return pageSize+1 rows to simulate "has more"
      const rows = Array.from({ length: 3 }, (_, i) =>
        dbRow({ id: `00000000-0000-0000-0000-0000000000${i + 10}`, mrn: `P-Z000000${i}` }),
      );
      prisma.responses.push(rows);
      const out = await svc.list({ pageSize: 2 });
      expect(out.data).toHaveLength(2);
      expect(out.meta.hasMore).toBe(true);
      expect(out.meta.nextCursor).not.toBeNull();
    });
  });

  describe('update', () => {
    it('writes an audit row enumerating which fields changed', async () => {
      prisma.responses.push([dbRow()]); // load existing
      prisma.responses.push([dbRow({ first_name_enc: 'enc:Alicia' })]); // UPDATE RETURNING

      const updated = await svc.update(
        '00000000-0000-0000-0000-000000000001',
        { firstName: 'Alicia' },
        'actor-1',
      );

      expect(updated.firstName).toBe('Alicia');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'patient.update',
          payload: { changedFields: ['firstName'] },
        }),
      );
    });

    it('no-ops gracefully when no fields are provided', async () => {
      prisma.responses.push([dbRow()]); // load existing
      const out = await svc.update('00000000-0000-0000-0000-000000000001', {}, 'actor-1');
      expect(out.firstName).toBe('Alice');
      // Only the SELECT happened, no INSERT/UPDATE.
      expect(prisma.calls).toHaveLength(1);
      expect(mockAudit.write).not.toHaveBeenCalled();
    });
  });

  describe('addDependent', () => {
    it('rejects when the guardian patient does not exist', async () => {
      prisma.responses.push([]); // guardian lookup
      await expect(
        svc.addDependent(
          '00000000-0000-0000-0000-000000000099',
          {
            firstName: 'Charlie',
            lastName: 'Doe',
            dob: '2010-05-10',
            relation: 'CHILD',
          },
          'actor-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
