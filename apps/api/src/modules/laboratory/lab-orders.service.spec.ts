import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { LabOrdersService } from './lab-orders.service';

class MockPrisma {
  public responses: unknown[][] = [];
  $queryRaw = jest.fn(() => Promise.resolve(this.responses.shift() ?? []));
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
} as unknown as ConstructorParameters<typeof LabOrdersService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof LabOrdersService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof LabOrdersService>[3];

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ord-1',
  encounter_id: 'enc-1',
  patient_id: 'pat-1',
  ordered_by_user_id: 'doc-1',
  priority: 'ROUTINE',
  status: 'PENDING_COLLECTION',
  sample_barcode: 'BC-001',
  notes_enc: null,
  ordered_at: new Date('2025-02-01T10:00:00Z'),
  collected_at: null,
  completed_at: null,
  cancelled_reason: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  updated_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  lab_order_id: 'ord-1',
  lab_test_id: 'test-1',
  status: 'PENDING',
  instructions_enc: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  updated_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

describe('LabOrdersService', () => {
  let prisma: MockPrisma;
  let svc: LabOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new LabOrdersService(
      prisma as unknown as ConstructorParameters<typeof LabOrdersService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('create', () => {
    it('creates an order with items and writes audit', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]); // encounter
      prisma.responses.push([{ id: 'test-1', is_active: true }]); // tests
      prisma.responses.push([orderRow()]); // header insert
      prisma.responses.push([itemRow()]); // item insert

      const o = await svc.create(
        {
          encounterId: 'enc-1',
          sampleBarcode: 'BC-001',
          items: [{ labTestId: 'test-1' }],
        },
        'doc-1',
      );
      expect(o.id).toBe('ord-1');
      expect(o.status).toBe('PENDING_COLLECTION');
      expect(o.items).toHaveLength(1);
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lab_order.create' }),
      );
    });

    it('rejects when encounter is not OPEN', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'CLOSED' }]);
      await expect(
        svc.create(
          { encounterId: 'enc-1', sampleBarcode: 'BC', items: [{ labTestId: 'test-1' }] },
          'doc-1',
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects duplicate lab tests in the same order', async () => {
      await expect(
        svc.create(
          {
            encounterId: 'enc-1',
            sampleBarcode: 'BC',
            items: [{ labTestId: 'test-1' }, { labTestId: 'test-1' }],
          },
          'doc-1',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an inactive lab test', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]);
      prisma.responses.push([{ id: 'test-1', is_active: false }]);
      await expect(
        svc.create(
          {
            encounterId: 'enc-1',
            sampleBarcode: 'BC',
            items: [{ labTestId: 'test-1' }],
          },
          'doc-1',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateStatus (with compare-and-swap)', () => {
    it('transitions PENDING_COLLECTION -> COLLECTED and writes audit', async () => {
      prisma.responses.push([{ id: 'ord-1', status: 'PENDING_COLLECTION' }]);
      prisma.responses.push([orderRow({ status: 'COLLECTED' })]);
      // Fetch helper: header + items + latest results
      prisma.responses.push([orderRow({ status: 'COLLECTED' })]); // header re-fetch
      prisma.responses.push([itemRow()]); // items
      const o = await svc.updateStatus('ord-1', { status: 'COLLECTED' }, 'lab-1');
      expect(o.status).toBe('COLLECTED');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lab_order.status.update',
          payload: expect.objectContaining({ from: 'PENDING_COLLECTION', to: 'COLLECTED' }),
        }),
      );
    });

    it('rejects with TRANSITION_CONFLICT when the compare-and-swap matches zero rows', async () => {
      prisma.responses.push([{ id: 'ord-1', status: 'PENDING_COLLECTION' }]);
      prisma.responses.push([]); // CAS update returns no row
      const p = svc.updateStatus('ord-1', { status: 'COLLECTED' }, 'lab-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_ORDER_TRANSITION_CONFLICT' });
      expect(mockAudit.write).not.toHaveBeenCalled();
    });

    it('rejects COMPLETED when any item is still open', async () => {
      prisma.responses.push([{ id: 'ord-1', status: 'IN_PROGRESS' }]);
      prisma.responses.push([{ count: 2 }]); // 2 items still open
      const p = svc.updateStatus('ord-1', { status: 'COMPLETED' }, 'lab-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_ORDER_ITEMS_OPEN' });
    });

    it('rejects a transition out of a terminal state', async () => {
      prisma.responses.push([{ id: 'ord-1', status: 'COMPLETED' }]);
      await expect(
        svc.updateStatus('ord-1', { status: 'CANCELLED', cancelledReason: 'oops' }, 'lab-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('requires cancelledReason on CANCELLED transition', async () => {
      prisma.responses.push([{ id: 'ord-1', status: 'COLLECTED' }]);
      await expect(
        svc.updateStatus('ord-1', { status: 'CANCELLED' }, 'lab-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('returns NotFoundError when order does not exist', async () => {
      prisma.responses.push([]);
      await expect(
        svc.updateStatus('missing', { status: 'COLLECTED' }, 'lab-1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
