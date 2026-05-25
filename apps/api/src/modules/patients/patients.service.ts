import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  CreateDependentDto,
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './dto/create-patient.dto';
import {
  DependentDto,
  DependentRelation,
  PatientDto,
  PatientSex,
  PatientStatus,
} from './dto/patient.dto';

interface PatientRow {
  id: string;
  mrn: string;
  first_name_enc: string;
  last_name_enc: string;
  dob_enc: string;
  sex: PatientSex;
  phone_enc: string | null;
  email_enc: string | null;
  address_enc: string | null;
  preferred_language: string;
  portal_user_id: string | null;
  status: PatientStatus;
  registered_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface DependentRow {
  id: string;
  guardian_patient_id: string;
  patient_id: string | null;
  first_name_enc: string;
  last_name_enc: string;
  dob_enc: string;
  relation: DependentRelation;
  created_at: Date;
  updated_at: Date;
}

export interface ListPatientsResult {
  data: PatientDto[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async register(input: CreatePatientDto, actorUserId: string | null): Promise<PatientDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const mrn = input.mrn ?? this.generateMrn();

    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.patients WHERE mrn = ${mrn} LIMIT 1`,
    );
    if (existing.length > 0) {
      throw new ConflictError(`MRN already in use: ${mrn}`, 'PATIENT_MRN_TAKEN');
    }

    const [firstEnc, lastEnc, dobEnc, phoneEnc, emailEnc, addrEnc] = await Promise.all([
      this.encryption.encrypt(ctx.hospitalId, input.firstName),
      this.encryption.encrypt(ctx.hospitalId, input.lastName),
      this.encryption.encrypt(ctx.hospitalId, input.dob),
      input.phone ? this.encryption.encrypt(ctx.hospitalId, input.phone) : Promise.resolve(null),
      input.email ? this.encryption.encrypt(ctx.hospitalId, input.email) : Promise.resolve(null),
      input.address
        ? this.encryption.encrypt(ctx.hospitalId, input.address)
        : Promise.resolve(null),
    ]);

    const rows = await this.prisma.$queryRaw<PatientRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.patients (
        mrn, first_name_enc, last_name_enc, dob_enc, sex,
        phone_enc, email_enc, address_enc, preferred_language, portal_user_id
      ) VALUES (
        ${mrn}, ${firstEnc}, ${lastEnc}, ${dobEnc}, ${input.sex},
        ${phoneEnc}, ${emailEnc}, ${addrEnc},
        ${input.preferredLanguage ?? 'en'}, ${input.portalUserId ?? null}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Patient INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'patient.register',
      resource: 'patient',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { mrn: row.mrn, sex: row.sex },
    });

    return this.decryptPatient(ctx.hospitalId, row);
  }

  async findById(id: string): Promise<PatientDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<PatientRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.patients WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('patient', id);
    return this.decryptPatient(ctx.hospitalId, row);
  }

  async list(query: ListPatientsQueryDto): Promise<ListPatientsResult> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    // Cursor is base64('<createdAtIso>|<id>'). We sort by (created_at DESC, id DESC)
    // so newest patients land first; the cursor encodes the tail of the last page.
    const decodedCursor = decodeCursor(query.cursor);

    const filters: Prisma.Sql[] = [];
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    if (query.mrn) filters.push(Prisma.sql`mrn ILIKE ${'%' + query.mrn + '%'}`);
    if (decodedCursor) {
      filters.push(
        Prisma.sql`(created_at, id::text) < (${decodedCursor.createdAt}::timestamptz, ${decodedCursor.id})`,
      );
    }
    const whereClause =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<PatientRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.patients
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${pageSize + 1}
    `);

    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    const tail = page[page.length - 1];
    const nextCursor = hasMore && tail ? encodeCursor(tail.created_at, tail.id) : null;

    const decrypted = await Promise.all(
      page.map((row) => this.decryptPatient(ctx.hospitalId, row)),
    );
    return { data: decrypted, meta: { nextCursor, hasMore } };
  }

  async update(
    id: string,
    input: UpdatePatientDto,
    actorUserId: string | null,
  ): Promise<PatientDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Load existing first so we can audit-record the change set without
    // re-decrypting on every update.
    const existingRows = await this.prisma.$queryRaw<PatientRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.patients WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = existingRows[0];
    if (!existing) throw new NotFoundError('patient', id);

    const updates: Prisma.Sql[] = [];
    const changedFields: string[] = [];

    if (input.firstName !== undefined) {
      updates.push(
        Prisma.sql`first_name_enc = ${await this.encryption.encrypt(ctx.hospitalId, input.firstName)}`,
      );
      changedFields.push('firstName');
    }
    if (input.lastName !== undefined) {
      updates.push(
        Prisma.sql`last_name_enc = ${await this.encryption.encrypt(ctx.hospitalId, input.lastName)}`,
      );
      changedFields.push('lastName');
    }
    if (input.dob !== undefined) {
      updates.push(
        Prisma.sql`dob_enc = ${await this.encryption.encrypt(ctx.hospitalId, input.dob)}`,
      );
      changedFields.push('dob');
    }
    if (input.sex !== undefined) {
      updates.push(Prisma.sql`sex = ${input.sex}`);
      changedFields.push('sex');
    }
    if (input.phone !== undefined) {
      const enc = input.phone ? await this.encryption.encrypt(ctx.hospitalId, input.phone) : null;
      updates.push(Prisma.sql`phone_enc = ${enc}`);
      changedFields.push('phone');
    }
    if (input.email !== undefined) {
      const enc = input.email ? await this.encryption.encrypt(ctx.hospitalId, input.email) : null;
      updates.push(Prisma.sql`email_enc = ${enc}`);
      changedFields.push('email');
    }
    if (input.address !== undefined) {
      const enc = input.address
        ? await this.encryption.encrypt(ctx.hospitalId, input.address)
        : null;
      updates.push(Prisma.sql`address_enc = ${enc}`);
      changedFields.push('address');
    }
    if (input.preferredLanguage !== undefined) {
      updates.push(Prisma.sql`preferred_language = ${input.preferredLanguage}`);
      changedFields.push('preferredLanguage');
    }
    if (input.status !== undefined) {
      updates.push(Prisma.sql`status = ${input.status}`);
      changedFields.push('status');
    }

    if (updates.length === 0) return this.decryptPatient(ctx.hospitalId, existing);

    updates.push(Prisma.sql`updated_at = NOW()`);
    const rows = await this.prisma.$queryRaw<PatientRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.patients
      SET ${Prisma.join(updates, ', ')}
      WHERE id = ${id}::uuid
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('patient', id);

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'patient.update',
      resource: 'patient',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { changedFields },
    });

    return this.decryptPatient(ctx.hospitalId, row);
  }

  async addDependent(
    guardianPatientId: string,
    input: CreateDependentDto,
    actorUserId: string | null,
  ): Promise<DependentDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Validate guardian exists first; otherwise the FK error message leaks the
    // schema name to clients.
    const guardian = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.patients WHERE id = ${guardianPatientId}::uuid LIMIT 1`,
    );
    if (guardian.length === 0) throw new NotFoundError('patient', guardianPatientId);

    const [firstEnc, lastEnc, dobEnc] = await Promise.all([
      this.encryption.encrypt(ctx.hospitalId, input.firstName),
      this.encryption.encrypt(ctx.hospitalId, input.lastName),
      this.encryption.encrypt(ctx.hospitalId, input.dob),
    ]);

    const rows = await this.prisma.$queryRaw<DependentRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.dependents (
        guardian_patient_id, patient_id, first_name_enc, last_name_enc, dob_enc, relation
      ) VALUES (
        ${guardianPatientId}::uuid,
        ${input.patientId ? Prisma.sql`${input.patientId}::uuid` : Prisma.sql`NULL`},
        ${firstEnc}, ${lastEnc}, ${dobEnc}, ${input.relation}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Dependent INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'patient.dependent.create',
      resource: 'patient',
      resourceId: guardianPatientId,
      outcome: 'SUCCESS',
      payload: { dependentId: row.id, relation: row.relation },
    });

    return this.decryptDependent(ctx.hospitalId, row);
  }

  async listDependents(guardianPatientId: string): Promise<DependentDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<DependentRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.dependents
        WHERE guardian_patient_id = ${guardianPatientId}::uuid
        ORDER BY created_at ASC
      `,
    );
    return Promise.all(rows.map((row) => this.decryptDependent(ctx.hospitalId, row)));
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    // schemaName is validated by VALID_SCHEMA_RE upstream; we still re-assert
    // here because raw identifier injection is the highest-risk surface.
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }

  private generateMrn(): string {
    // Human-friendly MRN: P-XXXXXXXX (8 base36 chars). Collisions handled by
    // the UNIQUE constraint on mrn and surfaced as ConflictError.
    return `P-${randomBytes(5).toString('hex').toUpperCase().slice(0, 8)}`;
  }

  private async decryptPatient(hospitalId: string, row: PatientRow): Promise<PatientDto> {
    const [firstName, lastName, dob, phone, email, address] = await Promise.all([
      this.encryption.decrypt(hospitalId, row.first_name_enc),
      this.encryption.decrypt(hospitalId, row.last_name_enc),
      this.encryption.decrypt(hospitalId, row.dob_enc),
      row.phone_enc ? this.encryption.decrypt(hospitalId, row.phone_enc) : Promise.resolve(null),
      row.email_enc ? this.encryption.decrypt(hospitalId, row.email_enc) : Promise.resolve(null),
      row.address_enc
        ? this.encryption.decrypt(hospitalId, row.address_enc)
        : Promise.resolve(null),
    ]);
    return {
      id: row.id,
      mrn: row.mrn,
      firstName,
      lastName,
      dob,
      sex: row.sex,
      phone,
      email,
      address,
      preferredLanguage: row.preferred_language,
      portalUserId: row.portal_user_id,
      status: row.status,
      registeredAt: row.registered_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async decryptDependent(hospitalId: string, row: DependentRow): Promise<DependentDto> {
    const [firstName, lastName, dob] = await Promise.all([
      this.encryption.decrypt(hospitalId, row.first_name_enc),
      this.encryption.decrypt(hospitalId, row.last_name_enc),
      this.encryption.decrypt(hospitalId, row.dob_enc),
    ]);
    return {
      id: row.id,
      guardianPatientId: row.guardian_patient_id,
      patientId: row.patient_id,
      firstName,
      lastName,
      dob,
      relation: row.relation,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

interface DecodedCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = decoded.split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
