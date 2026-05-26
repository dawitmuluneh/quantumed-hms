import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateImagingStudyDto } from './dto/create-imaging.dto';
import { ImagingStudyDto } from './dto/imaging.dto';

interface ImagingStudyRow {
  id: string;
  imaging_request_id: string;
  equipment_id: string | null;
  performed_by_user_id: string;
  performed_at: Date;
  protocol: string | null;
  image_count: number;
  dicom_object_keys: string[];
  notes_enc: string | null;
  created_at: Date;
}

@Injectable()
export class ImagingStudiesService {
  private readonly logger = new Logger(ImagingStudiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Record performance of an imaging request. Runs in a single transaction
   * that locks the parent request, validates it's in a performable state,
   * inserts the study, and flips the request to PERFORMED in lock-step.
   */
  async record(
    imagingRequestId: string,
    input: CreateImagingStudyDto,
    actorUserId: string,
  ): Promise<ImagingStudyDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const performedBy = input.performedByUserId ?? actorUserId;
    const notesEnc = input.notes
      ? await this.encryption.encrypt(ctx.hospitalId, input.notes)
      : null;

    const inserted = await this.prisma.$transaction(async (tx) => {
      const requestRows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
        SELECT id, status FROM ${schemaIdent}.imaging_requests
        WHERE id = ${imagingRequestId}::uuid
        FOR UPDATE
      `);
      const req = requestRows[0];
      if (!req) throw new NotFoundError('imaging_request', imagingRequestId);
      if (
        req.status !== 'SCHEDULED' &&
        req.status !== 'IN_PROGRESS' &&
        req.status !== 'REQUESTED'
      ) {
        throw new ConflictError(
          `Cannot record a study against a request in status ${req.status}`,
          'IMAGING_REQUEST_NOT_PERFORMABLE',
        );
      }

      const rows = await tx.$queryRaw<ImagingStudyRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.imaging_studies (
          imaging_request_id, equipment_id, performed_by_user_id,
          performed_at, protocol, image_count, dicom_object_keys, notes_enc
        ) VALUES (
          ${imagingRequestId}::uuid,
          ${input.equipmentId ?? null},
          ${performedBy},
          NOW(),
          ${input.protocol ?? null},
          ${input.imageCount},
          ${input.dicomObjectKeys ?? []}::text[],
          ${notesEnc}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('imaging_studies INSERT returned no row');

      await tx.$queryRaw(Prisma.sql`
        UPDATE ${schemaIdent}.imaging_requests
        SET status = 'PERFORMED', updated_at = NOW()
        WHERE id = ${imagingRequestId}::uuid
      `);

      return row;
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'imaging_study.create',
      resource: 'imaging_study',
      resourceId: inserted.id,
      outcome: 'SUCCESS',
      payload: {
        imagingRequestId,
        performedByUserId: performedBy,
        imageCount: inserted.image_count,
      },
    });

    return this.toDto(ctx.hospitalId, inserted);
  }

  async findById(id: string): Promise<ImagingStudyDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingStudyRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.imaging_studies WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('imaging_study', id);
    return this.toDto(ctx.hospitalId, row);
  }

  async listForRequest(imagingRequestId: string): Promise<ImagingStudyDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ImagingStudyRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.imaging_studies
      WHERE imaging_request_id = ${imagingRequestId}::uuid
      ORDER BY performed_at DESC
    `);
    return Promise.all(rows.map((r) => this.toDto(ctx.hospitalId, r)));
  }

  private async toDto(hospitalId: string, row: ImagingStudyRow): Promise<ImagingStudyDto> {
    const notes = row.notes_enc ? await this.encryption.decrypt(hospitalId, row.notes_enc) : null;
    return {
      id: row.id,
      imagingRequestId: row.imaging_request_id,
      equipmentId: row.equipment_id,
      performedByUserId: row.performed_by_user_id,
      performedAt: row.performed_at.toISOString(),
      protocol: row.protocol,
      imageCount: row.image_count,
      dicomObjectKeys: row.dicom_object_keys,
      notes,
      createdAt: row.created_at.toISOString(),
    };
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }
}
