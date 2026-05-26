import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  CreatePrescriptionDto,
  CreatePrescriptionItemDto,
  UpdatePrescriptionStatusDto,
} from './dto/create-prescription.dto';
import {
  MedicineRoute,
  PrescriptionDto,
  PrescriptionItemDto,
  PrescriptionStatus,
} from './dto/prescription.dto';

/**
 * Slice of PrismaService surfaced inside a $transaction callback. We use the
 * raw-SQL escape hatch on the transactional client to stay schema-aware.
 */
type TxClient = Pick<PrismaService, '$queryRaw'>;

interface PrescriptionRow {
  id: string;
  encounter_id: string;
  patient_id: string;
  prescriber_user_id: string;
  status: PrescriptionStatus;
  notes_enc: string | null;
  issued_at: Date;
  cancelled_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PrescriptionItemRow {
  id: string;
  prescription_id: string;
  medicine_id: string;
  dose: string;
  route: MedicineRoute;
  frequency: string;
  duration_days: number | null;
  quantity_to_dispense: number;
  prn: boolean;
  prn_reason: string | null;
  instructions_enc: string | null;
  created_at: Date;
}

/**
 * Allowed prescription status transitions. ACTIVE is the only mutable state;
 * terminal states (COMPLETED, CANCELLED, SUPERSEDED) are sinks.
 */
const STATUS_TRANSITIONS: Record<PrescriptionStatus, PrescriptionStatus[]> = {
  ACTIVE: ['COMPLETED', 'CANCELLED', 'SUPERSEDED'],
  COMPLETED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreatePrescriptionDto, actorUserId: string): Promise<PrescriptionDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Encrypt PHI up front — outside the transaction, so the DB lock window
    // stays as small as possible. The ciphertext is opaque bytes, no FK or
    // schema dependency.
    const prescriberId = input.prescriberUserId ?? actorUserId;
    const notesEnc = input.notes
      ? await this.encryption.encrypt(ctx.hospitalId, input.notes)
      : null;
    const itemPayloads = await Promise.all(
      input.items.map(async (item) => ({
        item,
        instructionsEnc: item.instructions
          ? await this.encryption.encrypt(ctx.hospitalId, item.instructions)
          : null,
      })),
    );

    // Header + per-item INSERTs share a single transaction so a failure
    // partway through the loop rolls back the header instead of leaving an
    // orphaned prescription with a truncated item list.
    const { header, itemRows, encounterPatientId } = await this.prisma.$transaction(async (tx) => {
      const encounter = await tx.$queryRaw<
        Array<{ id: string; patient_id: string; status: string }>
      >(
        Prisma.sql`
            SELECT id, patient_id, status FROM ${schemaIdent}.encounters
            WHERE id = ${input.encounterId}::uuid LIMIT 1
          `,
      );
      const enc = encounter[0];
      if (!enc) throw new NotFoundError('encounter', input.encounterId);
      if (enc.status !== 'OPEN') {
        throw new ConflictError(
          `Cannot prescribe on a ${enc.status} encounter`,
          'ENCOUNTER_NOT_OPEN',
        );
      }

      // Validate every referenced medicine exists in this tenant and is
      // active. Doing it up front gives a deterministic 404 instead of an
      // FK error from the per-item INSERT.
      const medicineIds = Array.from(new Set(input.items.map((i) => i.medicineId)));
      const medicines = await tx.$queryRaw<Array<{ id: string; is_active: boolean }>>(
        Prisma.sql`
            SELECT id, is_active FROM ${schemaIdent}.medicines
            WHERE id::text = ANY(${medicineIds})
          `,
      );
      const found = new Map(medicines.map((m) => [m.id, m]));
      for (const id of medicineIds) {
        const m = found.get(id);
        if (!m) throw new NotFoundError('medicine', id);
        if (!m.is_active) {
          throw new ValidationError(`Cannot prescribe inactive medicine: ${id}`);
        }
      }

      const headerRows = await tx.$queryRaw<PrescriptionRow[]>(Prisma.sql`
          INSERT INTO ${schemaIdent}.prescriptions (
            encounter_id, patient_id, prescriber_user_id, status, notes_enc, issued_at
          ) VALUES (
            ${input.encounterId}::uuid,
            ${enc.patient_id}::uuid,
            ${prescriberId},
            'ACTIVE',
            ${notesEnc},
            NOW()
          )
          RETURNING *
        `);
      const headerRow = headerRows[0];
      if (!headerRow) throw new Error('Prescription INSERT returned no row');

      const inserted = await this.insertItems(tx, schemaIdent, headerRow.id, itemPayloads);

      return { header: headerRow, itemRows: inserted, encounterPatientId: enc.patient_id };
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'prescription.create',
      resource: 'prescription',
      resourceId: header.id,
      outcome: 'SUCCESS',
      payload: {
        encounterId: input.encounterId,
        patientId: encounterPatientId,
        prescriberUserId: prescriberId,
        itemCount: itemRows.length,
      },
    });

    return this.assemble(ctx.hospitalId, header, itemRows);
  }

  async findById(id: string): Promise<PrescriptionDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const headerRows = await this.prisma.$queryRaw<PrescriptionRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.prescriptions WHERE id = ${id}::uuid LIMIT 1`,
    );
    const header = headerRows[0];
    if (!header) throw new NotFoundError('prescription', id);
    const items = await this.prisma.$queryRaw<PrescriptionItemRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.prescription_items
        WHERE prescription_id = ${id}::uuid
        ORDER BY created_at ASC
      `,
    );
    return this.assemble(ctx.hospitalId, header, items);
  }

  async listForEncounter(encounterId: string): Promise<PrescriptionDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const headers = await this.prisma.$queryRaw<PrescriptionRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.prescriptions
        WHERE encounter_id = ${encounterId}::uuid
        ORDER BY issued_at DESC
      `,
    );
    return Promise.all(
      headers.map(async (header) => {
        const items = await this.prisma.$queryRaw<PrescriptionItemRow[]>(
          Prisma.sql`
            SELECT * FROM ${schemaIdent}.prescription_items
            WHERE prescription_id = ${header.id}::uuid
            ORDER BY created_at ASC
          `,
        );
        return this.assemble(ctx.hospitalId, header, items);
      }),
    );
  }

  async listForPatient(patientId: string): Promise<PrescriptionDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const headers = await this.prisma.$queryRaw<PrescriptionRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.prescriptions
        WHERE patient_id = ${patientId}::uuid
        ORDER BY issued_at DESC
        LIMIT 200
      `,
    );
    return Promise.all(
      headers.map(async (header) => {
        const items = await this.prisma.$queryRaw<PrescriptionItemRow[]>(
          Prisma.sql`
            SELECT * FROM ${schemaIdent}.prescription_items
            WHERE prescription_id = ${header.id}::uuid
            ORDER BY created_at ASC
          `,
        );
        return this.assemble(ctx.hospitalId, header, items);
      }),
    );
  }

  async updateStatus(
    id: string,
    input: UpdatePrescriptionStatusDto,
    actorUserId: string,
  ): Promise<PrescriptionDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const current = await this.prisma.$queryRaw<Array<{ id: string; status: PrescriptionStatus }>>(
      Prisma.sql`SELECT id, status FROM ${schemaIdent}.prescriptions WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = current[0];
    if (!existing) throw new NotFoundError('prescription', id);

    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition prescription from ${existing.status} to ${input.status}`,
        'PRESCRIPTION_TRANSITION_INVALID',
      );
    }
    if (input.status === 'CANCELLED' && !input.cancelledReason) {
      throw new ValidationError('cancelledReason is required when status=CANCELLED');
    }

    // Compare-and-swap on `status`. The UPDATE takes effect only if the row
    // is still in the state the prior SELECT observed; a concurrent transition
    // races us out and we surface a 409 so the caller can reload and retry.
    const headerRows = await this.prisma.$queryRaw<PrescriptionRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.prescriptions
      SET status = ${input.status},
          cancelled_reason = ${input.cancelledReason ?? null},
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status = ${existing.status}
      RETURNING *
    `);
    const header = headerRows[0];
    if (!header) {
      throw new ConflictError(
        'Prescription status was modified concurrently; please reload and retry',
        'PRESCRIPTION_TRANSITION_CONFLICT',
      );
    }

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'prescription.status.update',
      resource: 'prescription',
      resourceId: header.id,
      outcome: 'SUCCESS',
      payload: {
        from: existing.status,
        to: input.status,
        cancelledReason: input.cancelledReason ?? null,
      },
    });

    const items = await this.prisma.$queryRaw<PrescriptionItemRow[]>(
      Prisma.sql`
        SELECT * FROM ${schemaIdent}.prescription_items
        WHERE prescription_id = ${header.id}::uuid
        ORDER BY created_at ASC
      `,
    );
    return this.assemble(ctx.hospitalId, header, items);
  }

  private async insertItems(
    tx: TxClient,
    schemaIdent: Prisma.Sql,
    prescriptionId: string,
    items: Array<{ item: CreatePrescriptionItemDto; instructionsEnc: string | null }>,
  ): Promise<PrescriptionItemRow[]> {
    const out: PrescriptionItemRow[] = [];
    for (const { item, instructionsEnc } of items) {
      const rows = await tx.$queryRaw<PrescriptionItemRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.prescription_items (
          prescription_id, medicine_id, dose, route, frequency,
          duration_days, quantity_to_dispense, prn, prn_reason, instructions_enc
        ) VALUES (
          ${prescriptionId}::uuid,
          ${item.medicineId}::uuid,
          ${item.dose},
          ${item.route},
          ${item.frequency},
          ${item.durationDays ?? null},
          ${item.quantityToDispense},
          ${item.prn ?? false},
          ${item.prnReason ?? null},
          ${instructionsEnc}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('Prescription item INSERT returned no row');
      out.push(row);
    }
    return out;
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }

  private async assemble(
    hospitalId: string,
    header: PrescriptionRow,
    items: PrescriptionItemRow[],
  ): Promise<PrescriptionDto> {
    const notes = header.notes_enc
      ? await this.encryption.decrypt(hospitalId, header.notes_enc)
      : null;
    const decryptedItems = await Promise.all(
      items.map(async (item) => this.decryptItem(hospitalId, item)),
    );
    return {
      id: header.id,
      encounterId: header.encounter_id,
      patientId: header.patient_id,
      prescriberUserId: header.prescriber_user_id,
      status: header.status,
      notes,
      cancelledReason: header.cancelled_reason,
      issuedAt: header.issued_at.toISOString(),
      createdAt: header.created_at.toISOString(),
      updatedAt: header.updated_at.toISOString(),
      items: decryptedItems,
    };
  }

  private async decryptItem(
    hospitalId: string,
    row: PrescriptionItemRow,
  ): Promise<PrescriptionItemDto> {
    const instructions = row.instructions_enc
      ? await this.encryption.decrypt(hospitalId, row.instructions_enc)
      : null;
    return {
      id: row.id,
      prescriptionId: row.prescription_id,
      medicineId: row.medicine_id,
      dose: row.dose,
      route: row.route,
      frequency: row.frequency,
      durationDays: row.duration_days,
      quantityToDispense: row.quantity_to_dispense,
      prn: row.prn,
      prnReason: row.prn_reason,
      instructions,
      createdAt: row.created_at.toISOString(),
    };
  }
}
