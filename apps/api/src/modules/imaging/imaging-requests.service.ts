import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateImagingRequestDto, UpdateImagingRequestStatusDto } from './dto/create-imaging.dto';
import {
  ImagingModality,
  ImagingPriority,
  ImagingRequestDto,
  ImagingRequestStatus,
} from './dto/imaging.dto';

interface ImagingRequestRow {
  id: string;
  encounter_id: string;
  patient_id: string;
  ordered_by_user_id: string;
  modality: ImagingModality;
  body_part: string;
  priority: ImagingPriority;
  status: ImagingRequestStatus;
  clinical_question_enc: string | null;
  ordered_at: Date;
  scheduled_for: Date | null;
  cancelled_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Allowed imaging-request status transitions. CANCELLED is reachable from
 * any non-REPORTED state. REPORTED is reached as a side-effect of finalizing
 * the radiologist report (see ImagingReportsService), not by direct request
 * status updates — so callers cannot bypass the report state machine.
 */
const STATUS_TRANSITIONS: Record<ImagingRequestStatus, ImagingRequestStatus[]> = {
  REQUESTED: ['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PERFORMED', 'CANCELLED'],
  PERFORMED: ['CANCELLED'],
  REPORTED: [],
  CANCELLED: [],
};

@Injectable()
export class ImagingRequestsService {
  private readonly logger = new Logger(ImagingRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateImagingRequestDto, actorUserId: string): Promise<ImagingRequestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const orderedBy = input.orderedByUserId ?? actorUserId;
    const clinicalQuestionEnc = input.clinicalQuestion
      ? await this.encryption.encrypt(ctx.hospitalId, input.clinicalQuestion)
      : null;

    const encounter = await this.prisma.$queryRaw<
      Array<{ id: string; patient_id: string; status: string }>
    >(Prisma.sql`
      SELECT id, patient_id, status FROM ${schemaIdent}.encounters
      WHERE id = ${input.encounterId}::uuid LIMIT 1
    `);
    const enc = encounter[0];
    if (!enc) throw new NotFoundError('encounter', input.encounterId);
    if (enc.status !== 'OPEN') {
      throw new ConflictError(
        `Cannot order imaging on a ${enc.status} encounter`,
        'ENCOUNTER_NOT_OPEN',
      );
    }

    const rows = await this.prisma.$queryRaw<ImagingRequestRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.imaging_requests (
        encounter_id, patient_id, ordered_by_user_id, modality, body_part,
        priority, status, clinical_question_enc, ordered_at, scheduled_for
      ) VALUES (
        ${input.encounterId}::uuid,
        ${enc.patient_id}::uuid,
        ${orderedBy},
        ${input.modality},
        ${input.bodyPart},
        ${input.priority ?? 'ROUTINE'},
        ${input.scheduledFor ? 'SCHEDULED' : 'REQUESTED'},
        ${clinicalQuestionEnc},
        NOW(),
        ${input.scheduledFor ? new Date(input.scheduledFor) : null}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('imaging_requests INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_request.create',
      resource: 'imaging_request',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: {
        encounterId: input.encounterId,
        patientId: row.patient_id,
        modality: row.modality,
        bodyPart: row.body_part,
        priority: row.priority,
      },
    });

    return this.toDto(ctx.hospitalId, row);
  }

  async findById(id: string): Promise<ImagingRequestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingRequestRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.imaging_requests WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('imaging_request', id);
    return this.toDto(ctx.hospitalId, row);
  }

  async listForEncounter(encounterId: string): Promise<ImagingRequestDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingRequestRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.imaging_requests
      WHERE encounter_id = ${encounterId}::uuid
      ORDER BY ordered_at DESC
    `);
    return Promise.all(rows.map((r) => this.toDto(ctx.hospitalId, r)));
  }

  async listForPatient(patientId: string): Promise<ImagingRequestDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingRequestRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.imaging_requests
      WHERE patient_id = ${patientId}::uuid
      ORDER BY ordered_at DESC
      LIMIT 200
    `);
    return Promise.all(rows.map((r) => this.toDto(ctx.hospitalId, r)));
  }

  async updateStatus(
    id: string,
    input: UpdateImagingRequestStatusDto,
    actorUserId: string,
  ): Promise<ImagingRequestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const current = await this.prisma.$queryRaw<
      Array<{ id: string; status: ImagingRequestStatus }>
    >(
      Prisma.sql`SELECT id, status FROM ${schemaIdent}.imaging_requests WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = current[0];
    if (!existing) throw new NotFoundError('imaging_request', id);

    if (input.status === 'REPORTED') {
      throw new ConflictError(
        'REPORTED is set automatically when a report is finalized; do not transition directly.',
        'IMAGING_REQUEST_REPORTED_AUTO',
      );
    }

    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition imaging request from ${existing.status} to ${input.status}`,
        'IMAGING_REQUEST_TRANSITION_INVALID',
      );
    }
    if (input.status === 'CANCELLED' && !input.cancelledReason) {
      throw new ValidationError('cancelledReason is required when status=CANCELLED');
    }
    if (input.status === 'SCHEDULED' && !input.scheduledFor) {
      throw new ValidationError('scheduledFor is required when status=SCHEDULED');
    }

    // Compare-and-swap on `status` to defeat the same TOCTOU race that
    // bit the prescription state machine: two concurrent transitions
    // against the same row must not both succeed.
    const rows = await this.prisma.$queryRaw<ImagingRequestRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.imaging_requests
      SET status = ${input.status},
          cancelled_reason = ${input.cancelledReason ?? null},
          scheduled_for = CASE WHEN ${input.scheduledFor ?? null}::timestamptz IS NOT NULL
                               THEN ${input.scheduledFor ?? null}::timestamptz ELSE scheduled_for END,
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status = ${existing.status}
      RETURNING *
    `);
    const row = rows[0];
    if (!row) {
      throw new ConflictError(
        'Imaging request status was modified concurrently; please reload and retry',
        'IMAGING_REQUEST_TRANSITION_CONFLICT',
      );
    }

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_request.status.update',
      resource: 'imaging_request',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: {
        from: existing.status,
        to: input.status,
        cancelledReason: input.cancelledReason ?? null,
      },
    });

    return this.toDto(ctx.hospitalId, row);
  }

  /**
   * Internal helper for ImagingReportsService.finalize() to flip the request
   * to REPORTED inside the report-finalization transaction. Not exposed as
   * a controller route — callers must not transition to REPORTED directly.
   */
  async markReportedInTx(
    tx: Pick<PrismaService, '$queryRaw'>,
    schemaIdent: Prisma.Sql,
    requestId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE ${schemaIdent}.imaging_requests
      SET status = 'REPORTED', updated_at = NOW()
      WHERE id = ${requestId}::uuid
        AND status IN ('PERFORMED', 'IN_PROGRESS')
      RETURNING id
    `);
    if (!rows[0]) {
      throw new ConflictError(
        'Cannot finalize report: imaging request is not in PERFORMED state',
        'IMAGING_REQUEST_NOT_PERFORMED',
      );
    }
  }

  private async toDto(hospitalId: string, row: ImagingRequestRow): Promise<ImagingRequestDto> {
    const clinicalQuestion = row.clinical_question_enc
      ? await this.encryption.decrypt(hospitalId, row.clinical_question_enc)
      : null;
    return {
      id: row.id,
      encounterId: row.encounter_id,
      patientId: row.patient_id,
      orderedByUserId: row.ordered_by_user_id,
      modality: row.modality,
      bodyPart: row.body_part,
      priority: row.priority,
      status: row.status,
      clinicalQuestion,
      orderedAt: row.ordered_at.toISOString(),
      scheduledFor: row.scheduled_for?.toISOString() ?? null,
      cancelledReason: row.cancelled_reason,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }
}
