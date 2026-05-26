import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateLabTestDto, UpdateLabTestDto } from './dto/create-lab.dto';
import { LabTestDto, SpecimenType } from './dto/lab.dto';

interface LabTestRow {
  id: string;
  code: string;
  name: string;
  specimen_type: SpecimenType;
  unit: string | null;
  reference_low: string | number | null;
  reference_high: string | number | null;
  critical_low: string | number | null;
  critical_high: string | number | null;
  turnaround_minutes: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class LabTestsService {
  private readonly logger = new Logger(LabTestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateLabTestDto, actorUserId: string): Promise<LabTestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM ${schemaIdent}.lab_tests WHERE code = ${input.code} LIMIT 1
    `);
    if (existing[0]) {
      throw new ConflictError(
        `Lab test with code ${input.code} already exists`,
        'LAB_TEST_CODE_DUPLICATE',
      );
    }

    const rows = await this.prisma.$queryRaw<LabTestRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.lab_tests (
        code, name, specimen_type, unit,
        reference_low, reference_high, critical_low, critical_high,
        turnaround_minutes, is_active
      ) VALUES (
        ${input.code},
        ${input.name},
        ${input.specimenType},
        ${input.unit ?? null},
        ${input.referenceLow ?? null},
        ${input.referenceHigh ?? null},
        ${input.criticalLow ?? null},
        ${input.criticalHigh ?? null},
        ${input.turnaroundMinutes ?? null},
        ${input.isActive ?? true}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('lab_tests INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_test.create',
      resource: 'lab_test',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { code: row.code, name: row.name },
    });

    return this.toDto(row);
  }

  async update(id: string, input: UpdateLabTestDto, actorUserId: string): Promise<LabTestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const rows = await this.prisma.$queryRaw<LabTestRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.lab_tests
      SET name = COALESCE(${input.name ?? null}, name),
          specimen_type = COALESCE(${input.specimenType ?? null}, specimen_type),
          unit = CASE WHEN ${input.unit !== undefined}::boolean THEN ${input.unit ?? null} ELSE unit END,
          reference_low = CASE WHEN ${input.referenceLow !== undefined}::boolean THEN ${input.referenceLow ?? null} ELSE reference_low END,
          reference_high = CASE WHEN ${input.referenceHigh !== undefined}::boolean THEN ${input.referenceHigh ?? null} ELSE reference_high END,
          critical_low = CASE WHEN ${input.criticalLow !== undefined}::boolean THEN ${input.criticalLow ?? null} ELSE critical_low END,
          critical_high = CASE WHEN ${input.criticalHigh !== undefined}::boolean THEN ${input.criticalHigh ?? null} ELSE critical_high END,
          turnaround_minutes = CASE WHEN ${input.turnaroundMinutes !== undefined}::boolean THEN ${input.turnaroundMinutes ?? null} ELSE turnaround_minutes END,
          is_active = COALESCE(${input.isActive ?? null}, is_active),
          updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('lab_test', id);

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_test.update',
      resource: 'lab_test',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { changes: input as Record<string, unknown> },
    });

    return this.toDto(row);
  }

  async findById(id: string): Promise<LabTestDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<LabTestRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.lab_tests WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('lab_test', id);
    return this.toDto(row);
  }

  async list(opts: { activeOnly?: boolean }): Promise<LabTestDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = opts.activeOnly
      ? await this.prisma.$queryRaw<LabTestRow[]>(
          Prisma.sql`SELECT * FROM ${schemaIdent}.lab_tests WHERE is_active = TRUE ORDER BY code ASC`,
        )
      : await this.prisma.$queryRaw<LabTestRow[]>(
          Prisma.sql`SELECT * FROM ${schemaIdent}.lab_tests ORDER BY code ASC`,
        );
    return rows.map((r) => this.toDto(r));
  }

  private toDto(row: LabTestRow): LabTestDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      specimenType: row.specimen_type,
      unit: row.unit,
      referenceLow: row.reference_low === null ? null : Number(row.reference_low),
      referenceHigh: row.reference_high === null ? null : Number(row.reference_high),
      criticalLow: row.critical_low === null ? null : Number(row.critical_low),
      criticalHigh: row.critical_high === null ? null : Number(row.critical_high),
      turnaroundMinutes: row.turnaround_minutes,
      isActive: row.is_active,
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
