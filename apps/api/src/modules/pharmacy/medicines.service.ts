import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateMedicineDto, UpdateMedicineDto } from './dto/create-medicine.dto';
import { MedicineDto, MedicineForm } from './dto/pharmacy.dto';

interface MedicineRow {
  id: string;
  code: string;
  generic_name: string;
  brand_name: string | null;
  form: MedicineForm;
  strength: string | null;
  atc_code: string | null;
  is_controlled: boolean;
  default_unit: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class MedicinesService {
  private readonly logger = new Logger(MedicinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateMedicineDto, actorUserId: string): Promise<MedicineDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const existing = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.medicines WHERE code = ${input.code} LIMIT 1`,
    );
    if (existing.length > 0) {
      throw new ConflictError(`Medicine code already in use: ${input.code}`, 'MEDICINE_CODE_TAKEN');
    }

    const rows = await this.prisma.$queryRaw<MedicineRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.medicines (
        code, generic_name, brand_name, form, strength,
        atc_code, is_controlled, default_unit
      ) VALUES (
        ${input.code},
        ${input.genericName},
        ${input.brandName ?? null},
        ${input.form},
        ${input.strength ?? null},
        ${input.atcCode ?? null},
        ${input.isControlled ?? false},
        ${input.defaultUnit ?? 'unit'}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Medicine INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'medicine.create',
      resource: 'medicine',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { code: row.code, form: row.form, isControlled: row.is_controlled },
    });

    return toMedicineDto(row);
  }

  async findById(id: string): Promise<MedicineDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<MedicineRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.medicines WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('medicine', id);
    return toMedicineDto(row);
  }

  async list(opts: { search?: string; activeOnly?: boolean } = {}): Promise<MedicineDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const filters: Prisma.Sql[] = [];
    if (opts.search) {
      const needle = `%${opts.search}%`;
      filters.push(Prisma.sql`(code ILIKE ${needle} OR generic_name ILIKE ${needle})`);
    }
    if (opts.activeOnly) filters.push(Prisma.sql`is_active = TRUE`);
    const where =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<MedicineRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.medicines
      ${where}
      ORDER BY generic_name ASC, code ASC
      LIMIT 200
    `);
    return rows.map(toMedicineDto);
  }

  async update(id: string, input: UpdateMedicineDto, actorUserId: string): Promise<MedicineDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const updates: Prisma.Sql[] = [];
    const changedFields: string[] = [];
    if (input.brandName !== undefined) {
      updates.push(Prisma.sql`brand_name = ${input.brandName}`);
      changedFields.push('brandName');
    }
    if (input.strength !== undefined) {
      updates.push(Prisma.sql`strength = ${input.strength}`);
      changedFields.push('strength');
    }
    if (input.atcCode !== undefined) {
      updates.push(Prisma.sql`atc_code = ${input.atcCode}`);
      changedFields.push('atcCode');
    }
    if (input.isControlled !== undefined) {
      updates.push(Prisma.sql`is_controlled = ${input.isControlled}`);
      changedFields.push('isControlled');
    }
    if (input.isActive !== undefined) {
      updates.push(Prisma.sql`is_active = ${input.isActive}`);
      changedFields.push('isActive');
    }

    if (updates.length === 0) return this.findById(id);
    updates.push(Prisma.sql`updated_at = NOW()`);

    const rows = await this.prisma.$queryRaw<MedicineRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.medicines
      SET ${Prisma.join(updates, ', ')}
      WHERE id = ${id}::uuid
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('medicine', id);

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'medicine.update',
      resource: 'medicine',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { changedFields },
    });

    return toMedicineDto(row);
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }
}

export function toMedicineDto(row: MedicineRow): MedicineDto {
  return {
    id: row.id,
    code: row.code,
    genericName: row.generic_name,
    brandName: row.brand_name,
    form: row.form,
    strength: row.strength,
    atcCode: row.atc_code,
    isControlled: row.is_controlled,
    defaultUnit: row.default_unit,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
