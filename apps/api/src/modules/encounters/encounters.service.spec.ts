import { ConflictError, NotFoundError } from '../../common/errors/domain-error';

import { EncountersService, computeBmi } from './encounters.service';

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
} as unknown as ConstructorParameters<typeof EncountersService>[1];

const mockEncryption = {
  encrypt: jest.fn((_t: string, pt: string) => Promise.resolve(`enc:${pt}`)),
  decrypt: jest.fn((_t: string, ct: string) =>
    Promise.resolve(ct.startsWith('enc:') ? ct.slice(4) : ct),
  ),
} as unknown as ConstructorParameters<typeof EncountersService>[2];

const mockAudit = {
  write: jest.fn(() => Promise.resolve()),
  verifyChain: jest.fn(),
} as unknown as ConstructorParameters<typeof EncountersService>[3];

const encounterRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'enc-1',
  patient_id: 'pat-1',
  provider_user_id: 'doctor-1',
  appointment_id: null,
  encounter_type: 'OUTPATIENT',
  chief_complaint: 'cough',
  notes_enc: 'enc:initial visit',
  status: 'OPEN',
  started_at: new Date('2025-01-01T10:00:00Z'),
  ended_at: null,
  created_at: new Date('2025-01-01T10:00:00Z'),
  updated_at: new Date('2025-01-01T10:00:00Z'),
  ...overrides,
});

describe('computeBmi', () => {
  it('computes BMI to one decimal place', () => {
    // 70 kg, 175 cm -> 70 / 1.75^2 = 22.857...
    expect(computeBmi(70, 175)).toBe(22.9);
  });
  it('returns null when either input is missing', () => {
    expect(computeBmi(undefined, 175)).toBeNull();
    expect(computeBmi(70, undefined)).toBeNull();
    expect(computeBmi(0, 175)).toBeNull();
    expect(computeBmi(70, 0)).toBeNull();
  });
  it('returns null on negative inputs', () => {
    expect(computeBmi(-1, 175)).toBeNull();
    expect(computeBmi(70, -1)).toBeNull();
  });
});

describe('EncountersService', () => {
  let prisma: MockPrisma;
  let svc: EncountersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = new MockPrisma();
    svc = new EncountersService(
      prisma as unknown as ConstructorParameters<typeof EncountersService>[0],
      mockTenant,
      mockEncryption,
      mockAudit,
    );
  });

  describe('open', () => {
    it('opens an encounter with encrypted notes and writes audit', async () => {
      prisma.responses.push([{ id: 'pat-1' }]); // patient lookup
      prisma.responses.push([encounterRow()]); // INSERT RETURNING

      const enc = await svc.open(
        {
          patientId: 'pat-1',
          encounterType: 'OUTPATIENT',
          chiefComplaint: 'cough',
          notes: 'initial visit',
        },
        'doctor-1',
      );

      expect(enc.patientId).toBe('pat-1');
      expect(enc.providerUserId).toBe('doctor-1');
      expect(enc.notes).toBe('initial visit'); // decrypted view
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('hospital-1', 'initial visit');
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'encounter.open', resource: 'encounter' }),
      );
    });

    it('rejects when the patient does not exist in the tenant', async () => {
      prisma.responses.push([]); // patient lookup miss
      await expect(
        svc.open({ patientId: 'missing', encounterType: 'OUTPATIENT' }, 'doctor-1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('recordVitals', () => {
    it('computes BMI and persists it', async () => {
      prisma.responses.push([{ id: 'enc-1', status: 'OPEN' }]); // encounter lookup
      prisma.responses.push([
        {
          id: 'vit-1',
          encounter_id: 'enc-1',
          recorded_at: new Date(),
          heart_rate_bpm: 72,
          systolic_bp: 120,
          diastolic_bp: 80,
          spo2_pct: 98,
          temperature_c: '36.6',
          respiratory_rate: 14,
          weight_kg: '70.0',
          height_cm: '175.0',
          bmi: '22.9',
          pain_score: 2,
          notes: null,
          recorded_by_user_id: 'nurse-1',
          created_at: new Date(),
        },
      ]);

      const v = await svc.recordVitals(
        'enc-1',
        { weightKg: 70, heightCm: 175, heartRateBpm: 72, systolicBp: 120, diastolicBp: 80 },
        'nurse-1',
      );

      expect(v.bmi).toBe(22.9);
      expect(v.weightKg).toBe(70);
      expect(v.heightCm).toBe(175);
      expect(mockAudit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'encounter.vitals.record',
          payload: expect.objectContaining({ bmi: 22.9 }),
        }),
      );
    });

    it('rejects recording vitals on a closed encounter', async () => {
      prisma.responses.push([{ id: 'enc-1', status: 'CLOSED' }]);
      await expect(
        svc.recordVitals('enc-1', { weightKg: 70, heightCm: 175 }, 'nurse-1'),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
