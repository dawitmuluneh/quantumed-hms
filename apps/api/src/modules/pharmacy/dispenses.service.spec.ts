import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { DispensesService } from './dispenses.service';

class MockPrisma {
  public responses: unknown[][] = [];
  $queryRaw = jest.fn(() => Promise.resolve(this.responses.shift() ?? []));
  // The service runs the dispense flow inside a $transaction. For unit tests
  // we don't need real transactional semantics — invoke the callback with the
  // same client so the same queued responses are consumed in order.
  $transaction = jest.fn(<T>(cb: (tx: MockPrisma) => Promise<T>): Promise<T> => cb(this));
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
} as unknown as ConstructorParameters<typeof DispensesService>[1];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof DispensesService>[2];

const dispenseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'disp-1',
  prescription_item_id: 'rxi-1',
  batch_id: 'batch-1',
  quantity: 10,
  unit: 'capsule',
  dispensed_by_user_id: 'pharmacist-1',
  dispensed_at: new Date('2025-02-01T10:00:00Z'),
  notes: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

describe('DispensesService', () => {
  let prisma: MockPrisma;
  let svc: DispensesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new DispensesService(
      prisma as unknown as ConstructorParameters<typeof DispensesService>[0],
      mockTenant,
      mockAudit,
    );
  });

  describe('dispense', () => {
    it('decrements stock atomically and writes audit', async () => {
      // 1) prescription item lookup
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'ACTIVE',
          already_dispensed: 0,
        },
      ]);
      // 2) batch resolution by id
      prisma.responses.push([
        { id: 'batch-1', medicine_id: 'med-1', quantity_on_hand: 100, unit: 'capsule' },
      ]);
      // 3) atomic UPDATE
      prisma.responses.push([{ id: 'batch-1', quantity_on_hand: 90 }]);
      // 4) dispense INSERT RETURNING
      prisma.responses.push([dispenseRow()]);

      const d = await svc.dispense(
        { prescriptionItemId: 'rxi-1', batchId: 'batch-1', quantity: 10 },
        'pharmacist-1',
      );

      expect(d.quantity).toBe(10);
      expect(d.batchId).toBe('batch-1');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pharmacy.dispense',
          resource: 'prescription',
          payload: expect.objectContaining({ remainingAfter: 20 }),
        }),
      );
    });

    it('rejects when prescription is not active', async () => {
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'CANCELLED',
          already_dispensed: 0,
        },
      ]);
      await expect(
        svc.dispense({ prescriptionItemId: 'rxi-1', quantity: 10 }, 'pharmacist-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects when quantity exceeds remaining', async () => {
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'ACTIVE',
          already_dispensed: 25,
        },
      ]);
      await expect(
        svc.dispense({ prescriptionItemId: 'rxi-1', quantity: 10 }, 'pharmacist-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects when batch belongs to a different medicine', async () => {
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'ACTIVE',
          already_dispensed: 0,
        },
      ]);
      prisma.responses.push([
        { id: 'batch-x', medicine_id: 'med-2', quantity_on_hand: 100, unit: 'capsule' },
      ]);
      await expect(
        svc.dispense(
          { prescriptionItemId: 'rxi-1', batchId: 'batch-x', quantity: 5 },
          'pharmacist-1',
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('throws INSUFFICIENT_STOCK when the atomic update affects zero rows', async () => {
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'ACTIVE',
          already_dispensed: 0,
        },
      ]);
      // Lookup says stock is sufficient...
      prisma.responses.push([
        { id: 'batch-1', medicine_id: 'med-1', quantity_on_hand: 10, unit: 'capsule' },
      ]);
      // ...but the conditioned UPDATE matches zero rows (concurrent dispense
      // drained the batch between read and write).
      prisma.responses.push([]);

      await expect(
        svc.dispense(
          { prescriptionItemId: 'rxi-1', batchId: 'batch-1', quantity: 10 },
          'pharmacist-1',
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    });

    it('throws NotFoundError when the prescription item is missing', async () => {
      prisma.responses.push([]);
      await expect(
        svc.dispense({ prescriptionItemId: 'missing', quantity: 1 }, 'pharmacist-1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('picks the first-expiring batch when no batch id is provided (FEFO)', async () => {
      prisma.responses.push([
        {
          id: 'rxi-1',
          medicine_id: 'med-1',
          quantity_to_dispense: 30,
          rx_status: 'ACTIVE',
          already_dispensed: 0,
        },
      ]);
      prisma.responses.push([
        { id: 'batch-old', medicine_id: 'med-1', quantity_on_hand: 50, unit: 'capsule' },
      ]);
      prisma.responses.push([{ id: 'batch-old', quantity_on_hand: 45 }]);
      prisma.responses.push([dispenseRow({ batch_id: 'batch-old', quantity: 5 })]);

      const d = await svc.dispense({ prescriptionItemId: 'rxi-1', quantity: 5 }, 'pharmacist-1');
      expect(d.batchId).toBe('batch-old');
    });
  });
});
