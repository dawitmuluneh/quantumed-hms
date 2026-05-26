import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { LabResultsService } from './lab-results.service';

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
} as unknown as ConstructorParameters<typeof LabResultsService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof LabResultsService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof LabResultsService>[3];

const resultRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'res-1',
  lab_order_item_id: 'item-1',
  value_numeric: '12.5',
  value_text: null,
  unit: 'g/dL',
  flag: 'NORMAL',
  reference_low: '12',
  reference_high: '16',
  critical_low: '7',
  critical_high: '20',
  observed_at: new Date('2025-02-01T10:00:00Z'),
  entered_by_user_id: 'lab-tech-1',
  verified_by_user_id: null,
  verified_at: null,
  notes_enc: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

describe('LabResultsService', () => {
  let prisma: MockPrisma;
  let svc: LabResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new LabResultsService(
      prisma as unknown as ConstructorParameters<typeof LabResultsService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('enter', () => {
    it('flags a value below the critical low as CRITICAL_LOW (snapshotted from lab_tests)', async () => {
      prisma.responses.push([
        {
          id: 'item-1',
          lab_order_id: 'ord-1',
          lab_test_id: 'test-1',
          status: 'PENDING',
          unit: 'g/dL',
          reference_low: '12',
          reference_high: '16',
          critical_low: '7',
          critical_high: '20',
        },
      ]);
      prisma.responses.push([resultRow({ value_numeric: '5.0', flag: 'CRITICAL_LOW' })]);
      prisma.responses.push([]); // item status update

      const r = await svc.enter('item-1', { valueNumeric: 5.0, unit: 'g/dL' }, 'lab-tech-1');
      expect(r.flag).toBe('CRITICAL_LOW');
      expect(r.valueNumeric).toBe(5.0);
      // Snapshotted ranges round-trip:
      expect(r.criticalLow).toBe(7);
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lab_result.enter' }),
      );
    });

    it('uses caller-supplied flag when value is text-only', async () => {
      prisma.responses.push([
        {
          id: 'item-1',
          lab_order_id: 'ord-1',
          lab_test_id: 'test-1',
          status: 'PENDING',
          unit: null,
          reference_low: null,
          reference_high: null,
          critical_low: null,
          critical_high: null,
        },
      ]);
      prisma.responses.push([
        resultRow({ value_numeric: null, value_text: 'Positive', flag: 'ABNORMAL' }),
      ]);
      prisma.responses.push([]);

      const r = await svc.enter(
        'item-1',
        { valueText: 'Positive', flag: 'ABNORMAL' },
        'lab-tech-1',
      );
      expect(r.flag).toBe('ABNORMAL');
      expect(r.valueText).toBe('Positive');
    });

    it('rejects when both valueNumeric and valueText are missing', async () => {
      await expect(svc.enter('item-1', {}, 'lab-tech-1')).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects entering a result on a VERIFIED item', async () => {
      prisma.responses.push([
        {
          id: 'item-1',
          lab_order_id: 'ord-1',
          lab_test_id: 'test-1',
          status: 'VERIFIED',
          unit: null,
          reference_low: null,
          reference_high: null,
          critical_low: null,
          critical_high: null,
        },
      ]);
      await expect(svc.enter('item-1', { valueNumeric: 1 }, 'lab-tech-1')).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it('returns NotFoundError for a missing item', async () => {
      prisma.responses.push([]);
      await expect(svc.enter('missing', { valueNumeric: 1 }, 'lab-tech-1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('verify', () => {
    it('verifies the latest unverified result and writes audit', async () => {
      prisma.responses.push([resultRow()]); // FOR UPDATE select
      prisma.responses.push([{ id: 'res-1' }]); // latest check (this is latest)
      prisma.responses.push([{ id: 'item-1', status: 'RESULTED' }]); // item lock
      prisma.responses.push([
        resultRow({ verified_by_user_id: 'pathologist-1', verified_at: new Date() }),
      ]); // update
      prisma.responses.push([]); // item status update
      const v = await svc.verify('res-1', { verifiedByUserId: 'pathologist-1' }, 'lab-tech-2');
      expect(v.verifiedByUserId).toBe('pathologist-1');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'lab_result.verify' }),
      );
    });

    it('rejects self-verification (verifier matches enterer)', async () => {
      prisma.responses.push([resultRow({ entered_by_user_id: 'me' })]);
      const p = svc.verify('res-1', { verifiedByUserId: 'me' }, 'someone-else');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_RESULT_SELF_VERIFY' });
    });

    it('rejects verifying an already-verified result', async () => {
      prisma.responses.push([
        resultRow({ verified_by_user_id: 'someone', verified_at: new Date() }),
      ]);
      const p = svc.verify('res-1', {}, 'lab-tech-2');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_RESULT_ALREADY_VERIFIED' });
    });

    it('rejects verifying when this result is not the latest for its item', async () => {
      prisma.responses.push([resultRow()]); // FOR UPDATE
      prisma.responses.push([{ id: 'res-2' }]); // latest is a different result
      const p = svc.verify('res-1', { verifiedByUserId: 'pathologist-1' }, 'lab-tech-2');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_RESULT_NOT_LATEST' });
    });

    it('rejects verifying when item status is not RESULTED', async () => {
      prisma.responses.push([resultRow()]);
      prisma.responses.push([{ id: 'res-1' }]);
      prisma.responses.push([{ id: 'item-1', status: 'PENDING' }]);
      const p = svc.verify('res-1', { verifiedByUserId: 'pathologist-1' }, 'lab-tech-2');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'LAB_ITEM_NOT_RESULTED' });
    });
  });
});
