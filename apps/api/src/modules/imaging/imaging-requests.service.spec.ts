import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { ImagingRequestsService } from './imaging-requests.service';

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
} as unknown as ConstructorParameters<typeof ImagingRequestsService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof ImagingRequestsService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof ImagingRequestsService>[3];

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  encounter_id: 'enc-1',
  patient_id: 'pat-1',
  ordered_by_user_id: 'doc-1',
  modality: 'XRAY',
  body_part: 'Chest PA',
  priority: 'ROUTINE',
  status: 'REQUESTED',
  clinical_question_enc: null,
  ordered_at: new Date('2025-02-01T10:00:00Z'),
  scheduled_for: null,
  cancelled_reason: null,
  created_at: new Date('2025-02-01T10:00:00Z'),
  updated_at: new Date('2025-02-01T10:00:00Z'),
  ...overrides,
});

describe('ImagingRequestsService', () => {
  let prisma: MockPrisma;
  let svc: ImagingRequestsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new ImagingRequestsService(
      prisma as unknown as ConstructorParameters<typeof ImagingRequestsService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  it('creates a request against an OPEN encounter and writes audit', async () => {
    prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'OPEN' }]);
    prisma.responses.push([requestRow()]);
    const r = await svc.create(
      {
        encounterId: 'enc-1',
        modality: 'XRAY',
        bodyPart: 'Chest PA',
        clinicalQuestion: 'Rule out pneumonia',
      },
      'doc-1',
    );
    expect(r.modality).toBe('XRAY');
    expect(r.status).toBe('REQUESTED');
    expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'Rule out pneumonia');
    expect(mockAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'imaging_request.create' }),
    );
  });

  it('rejects ordering imaging on a closed encounter', async () => {
    prisma.responses.push([{ id: 'enc-1', patient_id: 'pat-1', status: 'CLOSED' }]);
    await expect(
      svc.create({ encounterId: 'enc-1', modality: 'XRAY', bodyPart: 'Chest' }, 'doc-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses direct REPORTED transitions (must go through report finalization)', async () => {
    prisma.responses.push([{ id: 'req-1', status: 'PERFORMED' }]);
    const p = svc.updateStatus('req-1', { status: 'REPORTED' }, 'doc-1');
    await expect(p).rejects.toBeInstanceOf(ConflictError);
    await expect(p).rejects.toMatchObject({ code: 'IMAGING_REQUEST_REPORTED_AUTO' });
  });

  it('requires cancelledReason when transitioning to CANCELLED', async () => {
    prisma.responses.push([{ id: 'req-1', status: 'REQUESTED' }]);
    await expect(
      svc.updateStatus('req-1', { status: 'CANCELLED' }, 'doc-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires scheduledFor when transitioning to SCHEDULED', async () => {
    prisma.responses.push([{ id: 'req-1', status: 'REQUESTED' }]);
    await expect(
      svc.updateStatus('req-1', { status: 'SCHEDULED' }, 'doc-1'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('raises TRANSITION_CONFLICT when the compare-and-swap matches zero rows', async () => {
    prisma.responses.push([{ id: 'req-1', status: 'REQUESTED' }]);
    prisma.responses.push([]); // CAS update returns 0
    const p = svc.updateStatus(
      'req-1',
      { status: 'SCHEDULED', scheduledFor: '2025-03-01T10:00:00Z' },
      'doc-1',
    );
    await expect(p).rejects.toBeInstanceOf(ConflictError);
    await expect(p).rejects.toMatchObject({ code: 'IMAGING_REQUEST_TRANSITION_CONFLICT' });
    expect(mockAudit.write).not.toHaveBeenCalled();
  });

  it('rejects an invalid transition from REQUESTED -> PERFORMED', async () => {
    prisma.responses.push([{ id: 'req-1', status: 'REQUESTED' }]);
    await expect(
      svc.updateStatus('req-1', { status: 'PERFORMED' }, 'doc-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns NotFoundError when request does not exist', async () => {
    prisma.responses.push([]);
    await expect(svc.findById('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
