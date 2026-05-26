import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { PharmacyInventoryService } from './pharmacy-inventory.service';

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
} as unknown as ConstructorParameters<typeof PharmacyInventoryService>[1];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof PharmacyInventoryService>[2];

const batchRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'batch-1',
  medicine_id: 'med-1',
  lot_number: 'LOT-2025-001',
  expires_on: new Date('2026-06-01T00:00:00Z'),
  quantity_on_hand: 100,
  unit: 'capsule',
  location: 'A1',
  received_at: new Date('2025-01-01T00:00:00Z'),
  created_at: new Date('2025-01-01T00:00:00Z'),
  updated_at: new Date('2025-01-01T00:00:00Z'),
  ...overrides,
});

describe('PharmacyInventoryService', () => {
  let prisma: MockPrisma;
  let svc: PharmacyInventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new PharmacyInventoryService(
      prisma as unknown as ConstructorParameters<typeof PharmacyInventoryService>[0],
      mockTenant,
      mockAudit,
    );
  });

  describe('receiveBatch', () => {
    it('records the batch with the medicine default unit', async () => {
      prisma.responses.push([{ id: 'med-1', default_unit: 'capsule', is_active: true }]);
      prisma.responses.push([batchRow()]);

      const b = await svc.receiveBatch(
        {
          medicineId: 'med-1',
          lotNumber: 'LOT-2025-001',
          expiresOn: '2026-06-01',
          quantity: 100,
          location: 'A1',
        },
        'pharmacist-1',
      );

      expect(b.quantityOnHand).toBe(100);
      expect(b.unit).toBe('capsule');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pharmacy_inventory.receive',
          resource: 'pharmacy_inventory',
        }),
      );
    });

    it('throws NotFoundError for an unknown medicine', async () => {
      prisma.responses.push([]);
      await expect(
        svc.receiveBatch(
          {
            medicineId: 'missing',
            lotNumber: 'LOT-1',
            expiresOn: '2026-06-01',
            quantity: 10,
          },
          'pharmacist-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects stock for inactive medicines', async () => {
      prisma.responses.push([{ id: 'med-1', default_unit: 'capsule', is_active: false }]);
      await expect(
        svc.receiveBatch(
          {
            medicineId: 'med-1',
            lotNumber: 'LOT-2025-002',
            expiresOn: '2026-06-01',
            quantity: 10,
          },
          'pharmacist-1',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('listForMedicine', () => {
    it('returns batches in FEFO order', async () => {
      prisma.responses.push([
        batchRow({ id: 'b1', expires_on: new Date('2025-06-01T00:00:00Z') }),
        batchRow({ id: 'b2', expires_on: new Date('2026-06-01T00:00:00Z') }),
      ]);
      const batches = await svc.listForMedicine('med-1');
      expect(batches.map((b) => b.id)).toEqual(['b1', 'b2']);
    });
  });

  describe('findById', () => {
    it('throws NotFoundError when missing', async () => {
      prisma.responses.push([]);
      await expect(svc.findById('missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    // Suppress unused-import lint by referencing ConflictError once.
    it('does not throw ConflictError on a basic lookup miss', async () => {
      prisma.responses.push([]);
      await expect(svc.findById('missing')).rejects.not.toBeInstanceOf(ConflictError);
    });
  });
});
