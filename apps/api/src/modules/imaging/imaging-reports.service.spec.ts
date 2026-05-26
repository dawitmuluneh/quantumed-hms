import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { ImagingReportsService } from './imaging-reports.service';

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
} as unknown as ConstructorParameters<typeof ImagingReportsService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof ImagingReportsService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof ImagingReportsService>[3];

const mockRequests = {
  markReportedInTx: jest.fn(() => Promise.resolve()),
} as unknown as ConstructorParameters<typeof ImagingReportsService>[4];

const reportRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rep-1',
  imaging_study_id: 'study-1',
  radiologist_user_id: 'rad-1',
  status: 'DRAFT',
  findings_enc: null,
  impression_enc: null,
  recommendations_enc: null,
  reviewer_user_id: null,
  signed_at: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  updated_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

describe('ImagingReportsService', () => {
  let prisma: MockPrisma;
  let svc: ImagingReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new ImagingReportsService(
      prisma as unknown as ConstructorParameters<typeof ImagingReportsService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
      mockRequests,
    );
  });

  describe('create', () => {
    it('creates a DRAFT report and encrypts PHI fields', async () => {
      prisma.responses.push([{ id: 'study-1' }]); // study exists
      prisma.responses.push([]); // no duplicate report
      prisma.responses.push([reportRow({ findings_enc: 'enc:Clear lungs.' })]);
      const r = await svc.create(
        'study-1',
        { findings: 'Clear lungs.', impression: 'Normal' },
        'rad-1',
      );
      expect(r.status).toBe('DRAFT');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'Clear lungs.');
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'Normal');
    });

    it('rejects creating a second report for the same study', async () => {
      prisma.responses.push([{ id: 'study-1' }]);
      prisma.responses.push([{ id: 'rep-existing' }]);
      const p = svc.create('study-1', {}, 'rad-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'IMAGING_REPORT_DUPLICATE' });
    });

    it('returns NotFoundError when study does not exist', async () => {
      prisma.responses.push([]);
      await expect(svc.create('missing', {}, 'rad-1')).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateStatus (state machine + CAS)', () => {
    it('transitions DRAFT -> PENDING_REVIEW and writes audit', async () => {
      prisma.responses.push([
        { id: 'rep-1', imaging_study_id: 'study-1', radiologist_user_id: 'rad-1', status: 'DRAFT' },
      ]);
      prisma.responses.push([reportRow({ status: 'PENDING_REVIEW' })]);
      const r = await svc.updateStatus('rep-1', { status: 'PENDING_REVIEW' }, 'rad-1');
      expect(r.status).toBe('PENDING_REVIEW');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'imaging_report.status.update' }),
      );
    });

    it('rejects self-review by the authoring radiologist', async () => {
      prisma.responses.push([
        {
          id: 'rep-1',
          imaging_study_id: 'study-1',
          radiologist_user_id: 'rad-1',
          status: 'PENDING_REVIEW',
        },
      ]);
      const p = svc.updateStatus('rep-1', { status: 'REVIEWED', reviewerUserId: 'rad-1' }, 'rad-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'IMAGING_REPORT_SELF_REVIEW' });
    });

    it('rejects an invalid transition (FINALIZED is terminal)', async () => {
      prisma.responses.push([
        {
          id: 'rep-1',
          imaging_study_id: 'study-1',
          radiologist_user_id: 'rad-1',
          status: 'FINALIZED',
        },
      ]);
      await expect(
        svc.updateStatus('rep-1', { status: 'REVIEWED' }, 'reviewer-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('raises TRANSITION_CONFLICT when the compare-and-swap matches zero rows', async () => {
      prisma.responses.push([
        {
          id: 'rep-1',
          imaging_study_id: 'study-1',
          radiologist_user_id: 'rad-1',
          status: 'REVIEWED',
        },
      ]);
      prisma.responses.push([]); // CAS update returns 0
      const p = svc.updateStatus('rep-1', { status: 'FINALIZED' }, 'rad-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'IMAGING_REPORT_TRANSITION_CONFLICT' });
      expect(mockAudit.write).not.toHaveBeenCalled();
      expect(mockRequests.markReportedInTx).not.toHaveBeenCalled();
    });

    it('flips the parent request to REPORTED inside the FINALIZED transaction', async () => {
      prisma.responses.push([
        {
          id: 'rep-1',
          imaging_study_id: 'study-1',
          radiologist_user_id: 'rad-1',
          status: 'REVIEWED',
        },
      ]);
      prisma.responses.push([reportRow({ status: 'FINALIZED' })]);
      prisma.responses.push([{ imaging_request_id: 'req-1' }]);
      const r = await svc.updateStatus('rep-1', { status: 'FINALIZED' }, 'rad-1');
      expect(r.status).toBe('FINALIZED');
      expect(mockRequests.markReportedInTx).toHaveBeenCalledWith(
        prisma,
        expect.anything(),
        'req-1',
      );
    });
  });

  describe('updateContents', () => {
    it('rejects editing a FINALIZED report', async () => {
      prisma.responses.push([{ status: 'FINALIZED' }]);
      const p = svc.updateContents('rep-1', { findings: 'edit' }, 'rad-1');
      await expect(p).rejects.toBeInstanceOf(ConflictError);
      await expect(p).rejects.toMatchObject({ code: 'IMAGING_REPORT_FINALIZED' });
    });
  });
});
