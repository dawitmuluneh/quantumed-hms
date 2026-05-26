import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { PrescriptionsService } from './prescriptions.service';

class MockPrisma {
  public responses: unknown[][] = [];
  $queryRaw = jest.fn(() => Promise.resolve(this.responses.shift() ?? []));
  // create() runs the encounter check, medicine validation, header INSERT and
  // per-item INSERTs inside a $transaction. For unit tests we don't need real
  // transactional semantics — invoke the callback with the same client.
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
} as unknown as ConstructorParameters<typeof PrescriptionsService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof PrescriptionsService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof PrescriptionsService>[3];

const prescriptionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rx-1',
  encounter_id: 'enc-1',
  patient_id: 'pat-1',
  prescriber_user_id: 'doctor-1',
  status: 'ACTIVE',
  notes_enc: 'enc:see chart',
  issued_at: new Date('2025-01-01T10:00:00Z'),
  cancelled_reason: null,
  created_at: new Date('2025-01-01T10:00:00Z'),
  updated_at: new Date('2025-01-01T10:00:00Z'),
  ...overrides,
});

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rxi-1',
  prescription_id: 'rx-1',
  medicine_id: 'med-1',
  dose: '1 tablet',
  route: 'ORAL',
  frequency: 'BID',
  duration_days: 7,
  quantity_to_dispense: 14,
  prn: false,
  prn_reason: null,
  instructions_enc: 'enc:take with food',
  created_at: new Date('2025-01-01T10:00:00Z'),
  ...overrides,
});

describe('PrescriptionsService', () => {
  let prisma: MockPrisma;
  let svc: PrescriptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new PrescriptionsService(
      prisma as unknown as ConstructorParameters<typeof PrescriptionsService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('create', () => {
    it('creates a prescription with encrypted notes + instructions and writes audit', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]); // encounter
      prisma.responses.push([{ id: 'med-1', is_active: true }]); // medicines
      prisma.responses.push([prescriptionRow()]); // header insert
      prisma.responses.push([itemRow()]); // item insert

      const rx = await svc.create(
        {
          encounterId: 'enc-1',
          notes: 'see chart',
          items: [
            {
              medicineId: 'med-1',
              dose: '1 tablet',
              route: 'ORAL',
              frequency: 'BID',
              durationDays: 7,
              quantityToDispense: 14,
              instructions: 'take with food',
            },
          ],
        },
        'doctor-1',
      );

      expect(rx.id).toBe('rx-1');
      expect(rx.status).toBe('ACTIVE');
      expect(rx.notes).toBe('see chart');
      expect(rx.items).toHaveLength(1);
      expect(rx.items[0]?.instructions).toBe('take with food');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'see chart');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'take with food');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'prescription.create', resource: 'prescription' }),
      );
    });

    it('rejects when the encounter is not OPEN', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'CLOSED' }]);
      await expect(
        svc.create(
          {
            encounterId: 'enc-1',
            items: [
              {
                medicineId: 'med-1',
                dose: '1',
                route: 'ORAL',
                frequency: 'BID',
                quantityToDispense: 1,
              },
            ],
          },
          'doctor-1',
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects unknown medicines with a NotFoundError', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]);
      prisma.responses.push([]); // no medicines found
      await expect(
        svc.create(
          {
            encounterId: 'enc-1',
            items: [
              {
                medicineId: 'med-missing',
                dose: '1',
                route: 'ORAL',
                frequency: 'BID',
                quantityToDispense: 1,
              },
            ],
          },
          'doctor-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejects inactive medicines with a ValidationError', async () => {
      prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]);
      prisma.responses.push([{ id: 'med-1', is_active: false }]);
      await expect(
        svc.create(
          {
            encounterId: 'enc-1',
            items: [
              {
                medicineId: 'med-1',
                dose: '1',
                route: 'ORAL',
                frequency: 'BID',
                quantityToDispense: 1,
              },
            ],
          },
          'doctor-1',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateStatus', () => {
    it('transitions ACTIVE -> COMPLETED and writes audit', async () => {
      prisma.responses.push([{ id: 'rx-1', status: 'ACTIVE' }]);
      prisma.responses.push([prescriptionRow({ status: 'COMPLETED' })]);
      prisma.responses.push([itemRow()]);

      const rx = await svc.updateStatus('rx-1', { status: 'COMPLETED' }, 'pharmacist-1');

      expect(rx.status).toBe('COMPLETED');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'prescription.status.update',
          payload: expect.objectContaining({ from: 'ACTIVE', to: 'COMPLETED' }),
        }),
      );
    });

    it('rejects a transition out of a terminal state', async () => {
      prisma.responses.push([{ id: 'rx-1', status: 'CANCELLED' }]);
      await expect(
        svc.updateStatus('rx-1', { status: 'ACTIVE' }, 'pharmacist-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('requires cancelledReason when transitioning to CANCELLED', async () => {
      prisma.responses.push([{ id: 'rx-1', status: 'ACTIVE' }]);
      await expect(
        svc.updateStatus('rx-1', { status: 'CANCELLED' }, 'doctor-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
