import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  AddDiagnosisDto,
  CreateEncounterDto,
  RecordVitalsDto,
  UpdateEncounterDto,
} from './dto/create-encounter.dto';
import {
  EncounterDiagnosisDto,
  EncounterDto,
  EncounterStatus,
  EncounterType,
  VitalsDto,
} from './dto/encounter.dto';

interface EncounterRow {
  id: string;
  patient_id: string;
  provider_user_id: string;
  appointment_id: string | null;
  encounter_type: EncounterType;
  chief_complaint: string | null;
  notes_enc: string | null;
  status: EncounterStatus;
  started_at: Date;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface VitalsRow {
  id: string;
  encounter_id: string;
  recorded_at: Date;
  heart_rate_bpm: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  spo2_pct: number | null;
  temperature_c: string | null;
  respiratory_rate: number | null;
  weight_kg: string | null;
  height_cm: string | null;
  bmi: string | null;
  pain_score: number | null;
  notes: string | null;
  recorded_by_user_id: string;
  created_at: Date;
}

interface DiagnosisRow {
  id: string;
  encounter_id: string;
  icd10_code: string;
  icd10_description: string;
  is_primary: boolean;
  created_at: Date;
}

@Injectable()
export class EncountersService {
  private readonly logger = new Logger(EncountersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async open(input: CreateEncounterDto, actorUserId: string): Promise<EncounterDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Ensure the patient exists in this tenant (FK error would expose the
    // schema name; this gives a clean 404).
    const patient = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.patients WHERE id = ${input.patientId}::uuid LIMIT 1`,
    );
    if (patient.length === 0) throw new NotFoundError('patient', input.patientId);

    const providerId = input.providerUserId ?? actorUserId;
    const notesEnc = input.notes
      ? await this.encryption.encrypt(ctx.hospitalId, input.notes)
      : null;

    const rows = await this.prisma.$queryRaw<EncounterRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.encounters (
        patient_id, provider_user_id, appointment_id, encounter_type,
        chief_complaint, notes_enc, status, started_at
      ) VALUES (
        ${input.patientId}::uuid,
        ${providerId},
        ${input.appointmentId ? Prisma.sql`${input.appointmentId}::uuid` : Prisma.sql`NULL`},
        ${input.encounterType},
        ${input.chiefComplaint ?? null},
        ${notesEnc},
        'OPEN',
        NOW()
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Encounter INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'encounter.open',
      resource: 'encounter',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: {
        patientId: input.patientId,
        providerUserId: providerId,
        encounterType: input.encounterType,
      },
    });

    return this.decryptEncounter(ctx.hospitalId, row);
  }

  async findById(id: string): Promise<EncounterDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<EncounterRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.encounters WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('encounter', id);
    return this.decryptEncounter(ctx.hospitalId, row);
  }

  async listForPatient(patientId: string): Promise<EncounterDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<EncounterRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.encounters
        WHERE patient_id = ${patientId}::uuid
        ORDER BY started_at DESC
        LIMIT 200
      `,
    );
    return Promise.all(rows.map((row) => this.decryptEncounter(ctx.hospitalId, row)));
  }

  async update(id: string, input: UpdateEncounterDto, actorUserId: string): Promise<EncounterDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const updates: Prisma.Sql[] = [];
    const changedFields: string[] = [];

    if (input.chiefComplaint !== undefined) {
      updates.push(Prisma.sql`chief_complaint = ${input.chiefComplaint}`);
      changedFields.push('chiefComplaint');
    }
    if (input.notes !== undefined) {
      const enc = input.notes ? await this.encryption.encrypt(ctx.hospitalId, input.notes) : null;
      updates.push(Prisma.sql`notes_enc = ${enc}`);
      changedFields.push('notes');
    }
    if (input.status !== undefined) {
      updates.push(Prisma.sql`status = ${input.status}`);
      changedFields.push('status');
      if (input.status === 'CLOSED') {
        const endedAt = input.endedAt ?? new Date().toISOString();
        updates.push(Prisma.sql`ended_at = ${endedAt}::timestamptz`);
        changedFields.push('endedAt');
      }
    } else if (input.endedAt !== undefined) {
      updates.push(Prisma.sql`ended_at = ${input.endedAt}::timestamptz`);
      changedFields.push('endedAt');
    }

    if (updates.length === 0) return this.findById(id);

    updates.push(Prisma.sql`updated_at = NOW()`);
    const rows = await this.prisma.$queryRaw<EncounterRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.encounters
      SET ${Prisma.join(updates, ', ')}
      WHERE id = ${id}::uuid
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('encounter', id);

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'encounter.update',
      resource: 'encounter',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { changedFields, status: row.status },
    });

    return this.decryptEncounter(ctx.hospitalId, row);
  }

  async recordVitals(
    encounterId: string,
    input: RecordVitalsDto,
    actorUserId: string,
  ): Promise<VitalsDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Ensure encounter exists and is open before recording.
    const encounter = await this.prisma.$queryRaw<Array<{ id: string; status: EncounterStatus }>>(
      Prisma.sql`SELECT id, status FROM ${schemaIdent}.encounters WHERE id = ${encounterId}::uuid LIMIT 1`,
    );
    const enc = encounter[0];
    if (!enc) throw new NotFoundError('encounter', encounterId);
    if (enc.status !== 'OPEN') {
      throw new ConflictError(
        `Cannot record vitals on a ${enc.status} encounter`,
        'ENCOUNTER_NOT_OPEN',
      );
    }

    const bmi = computeBmi(input.weightKg, input.heightCm);

    const rows = await this.prisma.$queryRaw<VitalsRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.vitals (
        encounter_id, recorded_at,
        heart_rate_bpm, systolic_bp, diastolic_bp, spo2_pct, temperature_c,
        respiratory_rate, weight_kg, height_cm, bmi, pain_score, notes,
        recorded_by_user_id
      ) VALUES (
        ${encounterId}::uuid, NOW(),
        ${input.heartRateBpm ?? null}, ${input.systolicBp ?? null}, ${input.diastolicBp ?? null},
        ${input.spo2Pct ?? null}, ${input.temperatureC ?? null},
        ${input.respiratoryRate ?? null}, ${input.weightKg ?? null}, ${input.heightCm ?? null},
        ${bmi}, ${input.painScore ?? null}, ${input.notes ?? null},
        ${actorUserId}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Vitals INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'encounter.vitals.record',
      resource: 'encounter',
      resourceId: encounterId,
      outcome: 'SUCCESS',
      payload: { vitalsId: row.id, bmi },
    });

    return toVitalsDto(row);
  }

  async listVitals(encounterId: string): Promise<VitalsDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<VitalsRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.vitals
        WHERE encounter_id = ${encounterId}::uuid
        ORDER BY recorded_at DESC
      `,
    );
    return rows.map(toVitalsDto);
  }

  async addDiagnosis(
    encounterId: string,
    input: AddDiagnosisDto,
    actorUserId: string,
  ): Promise<EncounterDiagnosisDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const encounter = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.encounters WHERE id = ${encounterId}::uuid LIMIT 1`,
    );
    if (encounter.length === 0) throw new NotFoundError('encounter', encounterId);

    try {
      const rows = await this.prisma.$queryRaw<DiagnosisRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.encounter_diagnoses (
          encounter_id, icd10_code, icd10_description, is_primary
        ) VALUES (
          ${encounterId}::uuid, ${input.icd10Code}, ${input.icd10Description}, ${input.isPrimary ?? false}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('Diagnosis INSERT returned no row');

      await this.audit.write({
        hospitalId: ctx.hospitalId,
        actorUserId,
        action: 'encounter.diagnosis.add',
        resource: 'encounter',
        resourceId: encounterId,
        outcome: 'SUCCESS',
        payload: { code: row.icd10_code, isPrimary: row.is_primary },
      });

      return toDiagnosisDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010') {
        // P2010 wraps raw SQL errors. Surface the unique-constraint case as
        // a clean ConflictError so the client knows there's already a primary
        // diagnosis on the encounter.
        const msg = err.message ?? '';
        if (msg.includes('encounter_diagnoses_primary_uq')) {
          throw new ConflictError(
            'Encounter already has a primary diagnosis',
            'PRIMARY_DIAGNOSIS_EXISTS',
          );
        }
        if (msg.includes('encounter_diagnoses_code_fmt')) {
          throw new ValidationError(`Invalid ICD-10 code: ${input.icd10Code}`);
        }
      }
      throw err;
    }
  }

  async listDiagnoses(encounterId: string): Promise<EncounterDiagnosisDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<DiagnosisRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.encounter_diagnoses
        WHERE encounter_id = ${encounterId}::uuid
        ORDER BY is_primary DESC, created_at ASC
      `,
    );
    return rows.map(toDiagnosisDto);
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }

  private async decryptEncounter(hospitalId: string, row: EncounterRow): Promise<EncounterDto> {
    const notes = row.notes_enc ? await this.encryption.decrypt(hospitalId, row.notes_enc) : null;
    return {
      id: row.id,
      patientId: row.patient_id,
      providerUserId: row.provider_user_id,
      appointmentId: row.appointment_id,
      encounterType: row.encounter_type,
      chiefComplaint: row.chief_complaint,
      notes,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      endedAt: row.ended_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

/**
 * BMI = weight (kg) / (height (m))². Returns null if either input is missing
 * or zero. Result rounded to one decimal place; clinically meaningful precision
 * for charting.
 */
export function computeBmi(weightKg?: number, heightCm?: number): number | null {
  if (!weightKg || !heightCm) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  if (!Number.isFinite(bmi)) return null;
  return Math.round(bmi * 10) / 10;
}

function toVitalsDto(row: VitalsRow): VitalsDto {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    recordedAt: row.recorded_at.toISOString(),
    heartRateBpm: row.heart_rate_bpm,
    systolicBp: row.systolic_bp,
    diastolicBp: row.diastolic_bp,
    spo2Pct: row.spo2_pct,
    temperatureC: row.temperature_c !== null ? Number(row.temperature_c) : null,
    respiratoryRate: row.respiratory_rate,
    weightKg: row.weight_kg !== null ? Number(row.weight_kg) : null,
    heightCm: row.height_cm !== null ? Number(row.height_cm) : null,
    bmi: row.bmi !== null ? Number(row.bmi) : null,
    painScore: row.pain_score,
    notes: row.notes,
    recordedByUserId: row.recorded_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

function toDiagnosisDto(row: DiagnosisRow): EncounterDiagnosisDto {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    icd10Code: row.icd10_code,
    icd10Description: row.icd10_description,
    isPrimary: row.is_primary,
    createdAt: row.created_at.toISOString(),
  };
}
