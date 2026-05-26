import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  CreateImagingReportDto,
  UpdateImagingReportDto,
  UpdateImagingReportStatusDto,
} from './dto/create-imaging.dto';
import { ImagingReportDto, ImagingReportStatus } from './dto/imaging.dto';
import { ImagingRequestsService } from './imaging-requests.service';

interface ImagingReportRow {
  id: string;
  imaging_study_id: string;
  radiologist_user_id: string;
  status: ImagingReportStatus;
  findings_enc: string | null;
  impression_enc: string | null;
  recommendations_enc: string | null;
  reviewer_user_id: string | null;
  signed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Radiologist report status transitions. Forward-only — once FINALIZED the
 * report is immutable. REVIEWED requires a reviewer distinct from the
 * radiologist (industry pattern: 4-eyes for the diagnostic record).
 */
const STATUS_TRANSITIONS: Record<ImagingReportStatus, ImagingReportStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'FINALIZED'],
  PENDING_REVIEW: ['REVIEWED', 'DRAFT'],
  REVIEWED: ['FINALIZED', 'DRAFT'],
  FINALIZED: [],
};

@Injectable()
export class ImagingReportsService {
  private readonly logger = new Logger(ImagingReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
    private readonly requests: ImagingRequestsService,
  ) {}

  async create(
    imagingStudyId: string,
    input: CreateImagingReportDto,
    actorUserId: string,
  ): Promise<ImagingReportDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const radiologistUserId = input.radiologistUserId ?? actorUserId;

    const studyRows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.imaging_studies WHERE id = ${imagingStudyId}::uuid LIMIT 1`,
    );
    if (!studyRows[0]) throw new NotFoundError('imaging_study', imagingStudyId);

    const dupe = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM ${schemaIdent}.imaging_reports WHERE imaging_study_id = ${imagingStudyId}::uuid LIMIT 1
    `);
    if (dupe[0]) {
      throw new ConflictError('A report already exists for this study', 'IMAGING_REPORT_DUPLICATE');
    }

    const findingsEnc = input.findings
      ? await this.encryption.encrypt(ctx.hospitalId, input.findings)
      : null;
    const impressionEnc = input.impression
      ? await this.encryption.encrypt(ctx.hospitalId, input.impression)
      : null;
    const recsEnc = input.recommendations
      ? await this.encryption.encrypt(ctx.hospitalId, input.recommendations)
      : null;

    const rows = await this.prisma.$queryRaw<ImagingReportRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.imaging_reports (
        imaging_study_id, radiologist_user_id, status,
        findings_enc, impression_enc, recommendations_enc
      ) VALUES (
        ${imagingStudyId}::uuid,
        ${radiologistUserId},
        'DRAFT',
        ${findingsEnc},
        ${impressionEnc},
        ${recsEnc}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('imaging_reports INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_report.create',
      resource: 'imaging_report',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { imagingStudyId, radiologistUserId },
    });

    return this.toDto(ctx.hospitalId, row);
  }

  /**
   * Edit the contents of a non-finalized report. Status is unchanged — use
   * updateStatus() for state machine transitions.
   */
  async updateContents(
    id: string,
    input: UpdateImagingReportDto,
    actorUserId: string,
  ): Promise<ImagingReportDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const current = await this.prisma.$queryRaw<Array<{ status: ImagingReportStatus }>>(
      Prisma.sql`SELECT status FROM ${schemaIdent}.imaging_reports WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = current[0];
    if (!existing) throw new NotFoundError('imaging_report', id);
    if (existing.status === 'FINALIZED') {
      throw new ConflictError('Cannot edit a FINALIZED report', 'IMAGING_REPORT_FINALIZED');
    }

    const findingsEnc =
      input.findings !== undefined
        ? input.findings
          ? await this.encryption.encrypt(ctx.hospitalId, input.findings)
          : null
        : undefined;
    const impressionEnc =
      input.impression !== undefined
        ? input.impression
          ? await this.encryption.encrypt(ctx.hospitalId, input.impression)
          : null
        : undefined;
    const recsEnc =
      input.recommendations !== undefined
        ? input.recommendations
          ? await this.encryption.encrypt(ctx.hospitalId, input.recommendations)
          : null
        : undefined;

    const rows = await this.prisma.$queryRaw<ImagingReportRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.imaging_reports
      SET findings_enc = CASE WHEN ${findingsEnc !== undefined}::boolean THEN ${findingsEnc ?? null} ELSE findings_enc END,
          impression_enc = CASE WHEN ${impressionEnc !== undefined}::boolean THEN ${impressionEnc ?? null} ELSE impression_enc END,
          recommendations_enc = CASE WHEN ${recsEnc !== undefined}::boolean THEN ${recsEnc ?? null} ELSE recommendations_enc END,
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status <> 'FINALIZED'
      RETURNING *
    `);
    const row = rows[0];
    if (!row) {
      throw new ConflictError(
        'Imaging report was finalized concurrently; cannot edit',
        'IMAGING_REPORT_FINALIZED_RACE',
      );
    }

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_report.update',
      resource: 'imaging_report',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: {
        fieldsTouched: {
          findings: input.findings !== undefined,
          impression: input.impression !== undefined,
          recommendations: input.recommendations !== undefined,
        },
      },
    });

    return this.toDto(ctx.hospitalId, row);
  }

  /**
   * Advance the report through the state machine. FINALIZED is reached
   * inside a transaction that also flips the parent imaging_request to
   * REPORTED so the two state machines stay in sync.
   *
   * Uses a compare-and-swap UPDATE (status guard) to prevent two concurrent
   * transitions from both succeeding — the loser receives a 409.
   */
  async updateStatus(
    id: string,
    input: UpdateImagingReportStatusDto,
    actorUserId: string,
  ): Promise<ImagingReportDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const current = await this.prisma.$queryRaw<
      Array<{
        id: string;
        imaging_study_id: string;
        radiologist_user_id: string;
        status: ImagingReportStatus;
      }>
    >(
      Prisma.sql`SELECT id, imaging_study_id, radiologist_user_id, status
                 FROM ${schemaIdent}.imaging_reports WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = current[0];
    if (!existing) throw new NotFoundError('imaging_report', id);

    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition imaging report from ${existing.status} to ${input.status}`,
        'IMAGING_REPORT_TRANSITION_INVALID',
      );
    }

    if (input.status === 'REVIEWED') {
      if (!input.reviewerUserId && !actorUserId) {
        throw new ValidationError('reviewerUserId is required when transitioning to REVIEWED');
      }
      const reviewerId = input.reviewerUserId ?? actorUserId;
      if (reviewerId === existing.radiologist_user_id) {
        throw new ConflictError(
          'Imaging report reviewer must differ from the authoring radiologist',
          'IMAGING_REPORT_SELF_REVIEW',
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const reviewerId = input.reviewerUserId ?? null;
      const setSignedAt = input.status === 'FINALIZED';
      const setReviewer = input.status === 'REVIEWED';

      const rows = await tx.$queryRaw<ImagingReportRow[]>(Prisma.sql`
        UPDATE ${schemaIdent}.imaging_reports
        SET status = ${input.status},
            reviewer_user_id = CASE
              WHEN ${setReviewer}::boolean THEN ${reviewerId ?? actorUserId}
              ELSE reviewer_user_id
            END,
            signed_at = CASE
              WHEN ${setSignedAt}::boolean AND signed_at IS NULL THEN NOW()
              ELSE signed_at
            END,
            updated_at = NOW()
        WHERE id = ${id}::uuid
          AND status = ${existing.status}
        RETURNING *
      `);
      const updated = rows[0];
      if (!updated) {
        throw new ConflictError(
          'Imaging report status was modified concurrently; please reload and retry',
          'IMAGING_REPORT_TRANSITION_CONFLICT',
        );
      }

      if (input.status === 'FINALIZED') {
        // Look up the request id via the study and atomically flip the
        // request to REPORTED. Doing this in the same transaction keeps the
        // two state machines consistent — either both advance or neither.
        const reqRows = await tx.$queryRaw<Array<{ imaging_request_id: string }>>(Prisma.sql`
          SELECT imaging_request_id FROM ${schemaIdent}.imaging_studies
          WHERE id = ${existing.imaging_study_id}::uuid LIMIT 1
        `);
        const reqId = reqRows[0]?.imaging_request_id;
        if (!reqId) throw new NotFoundError('imaging_request_for_study', existing.imaging_study_id);
        await this.requests.markReportedInTx(tx, schemaIdent, reqId);
      }

      return updated;
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_report.status.update',
      resource: 'imaging_report',
      resourceId: result.id,
      outcome: 'SUCCESS',
      payload: {
        from: existing.status,
        to: input.status,
        reviewerUserId: result.reviewer_user_id,
      },
    });

    return this.toDto(ctx.hospitalId, result);
  }

  async findById(id: string): Promise<ImagingReportDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingReportRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.imaging_reports WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('imaging_report', id);
    return this.toDto(ctx.hospitalId, row);
  }

  async findForStudy(imagingStudyId: string): Promise<ImagingReportDto | null> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingReportRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.imaging_reports
      WHERE imaging_study_id = ${imagingStudyId}::uuid LIMIT 1
    `);
    const row = rows[0];
    return row ? this.toDto(ctx.hospitalId, row) : null;
  }

  private async toDto(hospitalId: string, row: ImagingReportRow): Promise<ImagingReportDto> {
    const findings = row.findings_enc
      ? await this.encryption.decrypt(hospitalId, row.findings_enc)
      : null;
    const impression = row.impression_enc
      ? await this.encryption.decrypt(hospitalId, row.impression_enc)
      : null;
    const recommendations = row.recommendations_enc
      ? await this.encryption.decrypt(hospitalId, row.recommendations_enc)
      : null;
    return {
      id: row.id,
      imagingStudyId: row.imaging_study_id,
      radiologistUserId: row.radiologist_user_id,
      status: row.status,
      findings,
      impression,
      recommendations,
      reviewerUserId: row.reviewer_user_id,
      signedAt: row.signed_at?.toISOString() ?? null,
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
