import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { MedicinesService } from './medicines.service';

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
} as unknown as ConstructorParameters<typeof MedicinesService>[1];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof MedicinesService>[2];

const medicineRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'med-1',
  code: 'AMOX-500',
  generic_name: 'Amoxicillin',
  brand_name: null,
  form: 'CAPSULE',
  strength: '500 mg',
  atc_code: 'J01CA04',
  is_controlled: false,
  default_unit: 'capsule',
  is_active: true,
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('MedicinesService', () => {
  let prisma: MockPrisma;
  let svc: MedicinesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new MedicinesService(
      prisma as unknown as ConstructorParameters<typeof MedicinesService>[0],
      mockTenant,
      mockAudit,
    );
  });

  describe('create', () => {
    it('adds a medicine and writes audit', async () => {
      prisma.responses.push([]); // uniqueness lookup
      prisma.responses.push([medicineRow()]); // insert

      const m = await svc.create(
        {
          code: 'AMOX-500',
          genericName: 'Amoxicillin',
          form: 'CAPSULE',
          strength: '500 mg',
          atcCode: 'J01CA04',
          defaultUnit: 'capsule',
        },
        'admin-1',
      );

      expect(m.code).toBe('AMOX-500');
      expect(m.defaultUnit).toBe('capsule');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'medicine.create', resource: 'medicine' }),
      );
    });

    it('rejects duplicate code with ConflictError', async () => {
      prisma.responses.push([{ id: 'med-existing' }]);
      await expect(
        svc.create({ code: 'AMOX-500', genericName: 'Amoxicillin', form: 'CAPSULE' }, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('findById', () => {
    it('returns the decoded medicine', async () => {
      prisma.responses.push([medicineRow()]);
      const m = await svc.findById('med-1');
      expect(m.id).toBe('med-1');
      expect(m.genericName).toBe('Amoxicillin');
    });

    it('throws NotFoundError when missing', async () => {
      prisma.responses.push([]);
      await expect(svc.findById('missing')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('update', () => {
    it('updates only provided fields and writes audit', async () => {
      prisma.responses.push([medicineRow({ is_active: false })]);
      const m = await svc.update('med-1', { isActive: false }, 'admin-1');
      expect(m.isActive).toBe(false);
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'medicine.update',
          payload: expect.objectContaining({ changedFields: ['isActive'] }),
        }),
      );
    });
  });
});
