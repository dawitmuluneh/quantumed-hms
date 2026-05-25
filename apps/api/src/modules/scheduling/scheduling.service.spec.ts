import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';

import { SchedulingService, STATUS_TRANSITIONS } from './scheduling.service';

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
} as unknown as ConstructorParameters<typeof SchedulingService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof SchedulingService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof SchedulingService>[3];

const appointmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'appt-1',
  patient_id: 'pat-1',
  provider_user_id: 'doctor-1',
  resource_id: null,
  scheduled_start: new Date('2025-06-01T09:00:00Z'),
  scheduled_end: new Date('2025-06-01T09:30:00Z'),
  status: 'SCHEDULED',
  reason: 'follow-up',
  notes_enc: null,
  encounter_id: null,
  created_by_user_id: 'reception-1',
  cancelled_reason: null,
  created_at: new Date('2025-05-01T00:00:00Z'),
  updated_at: new Date('2025-05-01T00:00:00Z'),
  ...overrides,
});

describe('STATUS_TRANSITIONS', () => {
  it('is a complete state machine — every status has an entry', () => {
    const statuses = [
      'SCHEDULED',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ] as const;
    for (const s of statuses) expect(STATUS_TRANSITIONS).toHaveProperty(s);
  });

  it('terminal statuses have no outgoing transitions', () => {
    expect(STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(STATUS_TRANSITIONS.NO_SHOW).toEqual([]);
  });
});

describe('SchedulingService', () => {
  let prisma: MockPrisma;
  let svc: SchedulingService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new SchedulingService(
      prisma as unknown as ConstructorParameters<typeof SchedulingService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('bookAppointment', () => {
    it('rejects when scheduledEnd <= scheduledStart', async () => {
      await expect(
        svc.bookAppointment(
          {
            patientId: 'pat-1',
            providerUserId: 'doctor-1',
            scheduledStart: '2025-06-01T10:00:00Z',
            scheduledEnd: '2025-06-01T10:00:00Z',
          },
          'reception-1',
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundError when the patient does not exist', async () => {
      prisma.responses.push([]); // patient lookup
      await expect(
        svc.bookAppointment(
          {
            patientId: 'missing',
            providerUserId: 'doctor-1',
            scheduledStart: '2025-06-01T09:00:00Z',
            scheduledEnd: '2025-06-01T09:30:00Z',
          },
          'reception-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('books the appointment and writes audit', async () => {
      prisma.responses.push([{ id: 'pat-1' }]); // patient lookup
      prisma.responses.push([appointmentRow()]); // INSERT RETURNING

      const appt = await svc.bookAppointment(
        {
          patientId: 'pat-1',
          providerUserId: 'doctor-1',
          scheduledStart: '2025-06-01T09:00:00Z',
          scheduledEnd: '2025-06-01T09:30:00Z',
          reason: 'follow-up',
        },
        'reception-1',
      );

      expect(appt.status).toBe('SCHEDULED');
      expect(appt.patientId).toBe('pat-1');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'appointment.book', resource: 'appointment' }),
      );
    });
  });

  describe('updateStatus', () => {
    it('rejects illegal transitions (e.g. CANCELLED -> SCHEDULED)', async () => {
      prisma.responses.push([appointmentRow({ status: 'CANCELLED' })]);
      await expect(
        svc.updateStatus('appt-1', { status: 'SCHEDULED' }, 'reception-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('requires cancelledReason when cancelling', async () => {
      prisma.responses.push([appointmentRow({ status: 'SCHEDULED' })]);
      await expect(
        svc.updateStatus('appt-1', { status: 'CANCELLED' }, 'reception-1'),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('advances SCHEDULED -> CONFIRMED and audits with from/to', async () => {
      prisma.responses.push([appointmentRow({ status: 'SCHEDULED' })]);
      prisma.responses.push([appointmentRow({ status: 'CONFIRMED' })]);
      const out = await svc.updateStatus('appt-1', { status: 'CONFIRMED' }, 'reception-1');
      expect(out.status).toBe('CONFIRMED');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'appointment.confirmed',
          payload: { from: 'SCHEDULED', to: 'CONFIRMED' },
        }),
      );
    });
  });
});
