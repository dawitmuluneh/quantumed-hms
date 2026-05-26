import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { LabTestsService } from './lab-tests.service';

class MockPrisma {
  public responses: unknown[][] = [];
  $queryRaw = jest.fn(() => Promise.resolve(this.responses.shift() ?? []));
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
} as unknown as ConstructorParameters<typeof LabTestsService>[1];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof LabTestsService>[2];

const testRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'test-1',
  code: 'CBC',
  name: 'Complete Blood Count',
  specimen_type: 'BLOOD',
  unit: 'cells/uL',
  reference_low: 4500,
  reference_high: 11000,
  critical_low: null,
  critical_high: null,
  turnaround_minutes: 60,
  is_active: true,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('LabTestsService', () => {
  let prisma: MockPrisma;
  let svc: LabTestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new LabTestsService(
      prisma as unknown as ConstructorParameters<typeof LabTestsService>[0],
      mockTenant,
      mockAudit,
    );
  });

  it('creates a new test and writes audit', async () => {
    prisma.responses.push([]); // uniqueness check
    prisma.responses.push([testRow()]); // insert
    const t = await svc.create(
      {
        code: 'CBC',
        name: 'Complete Blood Count',
        specimenType: 'BLOOD',
        unit: 'cells/uL',
        referenceLow: 4500,
        referenceHigh: 11000,
        turnaroundMinutes: 60,
      },
      'lab-admin-1',
    );
    expect(t.code).toBe('CBC');
    expect(t.referenceLow).toBe(4500);
    expect(t.referenceHigh).toBe(11000);
    expect(t.isActive).toBe(true);
    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lab_test.create', resource: 'lab_test' }),
    );
  });

  it('rejects creating a test with a duplicate code', async () => {
    prisma.responses.push([{ id: 'test-existing' }]);
    await expect(
      svc.create({ code: 'CBC', name: 'X', specimenType: 'BLOOD' }, 'lab-admin-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns NotFoundError when updating a non-existent test', async () => {
    prisma.responses.push([]);
    await expect(svc.update('missing', { name: 'X' }, 'lab-admin-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
