import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { ReceiveBatchDto } from './dto/create-medicine.dto';
import { InventoryBatchDto } from './dto/pharmacy.dto';

interface BatchRow {
  id: string;
  medicine_id: string;
  lot_number: string;
  expires_on: Date;
  quantity_on_hand: number;
  unit: string;
  location: string | null;
  received_at: Date;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PharmacyInventoryService {
  private readonly logger = new Logger(PharmacyInventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  async receiveBatch(input: ReceiveBatchDto, actorUserId: string): Promise<InventoryBatchDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    // Look up the medicine to validate existence + take the default unit if
    // the caller didn't supply one.
    const medicines = await this.prisma.$queryRaw<
      Array<{ id: string; default_unit: string; is_active: boolean }>
    >(
      Prisma.sql`
        SELECT id, default_unit, is_active FROM ${schemaIdent}.medicines
        WHERE id = ${input.medicineId}::uuid LIMIT 1
      `,
    );
    const medicine = medicines[0];
    if (!medicine) throw new NotFoundError('medicine', input.medicineId);
    if (!medicine.is_active) {
      throw new ValidationError(`Cannot receive stock for inactive medicine: ${input.medicineId}`);
    }

    const unit = input.unit ?? medicine.default_unit;

    try {
      const rows = await this.prisma.$queryRaw<BatchRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.pharmacy_inventory_batches (
          medicine_id, lot_number, expires_on, quantity_on_hand, unit, location, received_at
        ) VALUES (
          ${input.medicineId}::uuid,
          ${input.lotNumber},
          ${input.expiresOn}::date,
          ${input.quantity},
          ${unit},
          ${input.location ?? null},
          NOW()
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('Inventory batch INSERT returned no row');

      await this.audit.write({
        hospitalId: ctx.hospitalId,
        actorUserId,
        action: 'pharmacy_inventory.receive',
        resource: 'pharmacy_inventory',
        resourceId: row.id,
        outcome: 'SUCCESS',
        payload: {
          medicineId: row.medicine_id,
          lotNumber: row.lot_number,
          quantity: row.quantity_on_hand,
          expiresOn: row.expires_on.toISOString().slice(0, 10),
        },
      });

      return toBatchDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010') {
        const msg = err.message ?? '';
        if (msg.includes('pharmacy_inventory_batches_med_lot_uq')) {
          throw new ConflictError(
            `Lot ${input.lotNumber} already received for medicine ${input.medicineId}`,
            'INVENTORY_LOT_TAKEN',
          );
        }
      }
      throw err;
    }
  }

  async listForMedicine(medicineId: string): Promise<InventoryBatchDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<BatchRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.pharmacy_inventory_batches
      WHERE medicine_id = ${medicineId}::uuid
      ORDER BY expires_on ASC, received_at ASC
    `);
    return rows.map(toBatchDto);
  }

  async findById(id: string): Promise<InventoryBatchDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<BatchRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.pharmacy_inventory_batches WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('pharmacy_inventory', id);
    return toBatchDto(row);
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }
}

export function toBatchDto(row: BatchRow): InventoryBatchDto {
  return {
    id: row.id,
    medicineId: row.medicine_id,
    lotNumber: row.lot_number,
    expiresOn: row.expires_on.toISOString().slice(0, 10),
    quantityOnHand: row.quantity_on_hand,
    unit: row.unit,
    location: row.location,
    receivedAt: row.received_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
