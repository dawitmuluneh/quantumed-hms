import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateDispenseDto } from './dto/create-medicine.dto';
import { DispenseDto } from './dto/pharmacy.dto';

/**
 * Slice of PrismaService surfaced inside a $transaction callback. We use the
 * raw-SQL escape hatch on the transactional client to stay schema-aware.
 */
type TxClient = Pick<PrismaService, '$queryRaw'>;

interface DispenseRow {
  id: string;
  prescription_item_id: string;
  batch_id: string;
  quantity: number;
  unit: string;
  dispensed_by_user_id: string;
  dispensed_at: Date;
  notes: string | null;
  created_at: Date;
}

interface PrescriptionItemLookup {
  id: string;
  medicine_id: string;
  quantity_to_dispense: number;
  rx_status: string;
  already_dispensed: number;
}

interface BatchLookup {
  id: string;
  medicine_id: string;
  quantity_on_hand: number;
  unit: string;
}

@Injectable()
export class DispensesService {
  private readonly logger = new Logger(DispensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Records a dispense and decrements the chosen batch atomically.
   *
   * Patient-safety guarantees, all inside a single `$transaction`:
   *
   * 1. The prescription item row is locked with `SELECT ... FOR UPDATE`, which
   *    serializes concurrent dispenses against the same item. Without this
   *    lock two requests could both read the same `already_dispensed` total
   *    and each pass the remaining-quantity check.
   * 2. The inventory UPDATE is conditioned on `quantity_on_hand >= dispensed`
   *    — if the predicate is false (lost race with another dispense on the
   *    same batch) zero rows update and we throw `INSUFFICIENT_STOCK`.
   * 3. The dispense INSERT shares the transaction with the UPDATE, so a
   *    failure after the decrement rolls the stock back instead of "losing"
   *    inventory off the ledger.
   */
  async dispense(input: CreateDispenseDto, actorUserId: string): Promise<DispenseDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const { row, item, batch, remainingAfter } = await this.prisma.$transaction(async (tx) => {
      const itemLookup = await this.lookupPrescriptionItem(
        tx,
        schemaIdent,
        input.prescriptionItemId,
      );
      if (itemLookup.rx_status !== 'ACTIVE') {
        throw new ConflictError(
          `Cannot dispense against a ${itemLookup.rx_status} prescription`,
          'PRESCRIPTION_NOT_ACTIVE',
        );
      }
      const remaining = itemLookup.quantity_to_dispense - itemLookup.already_dispensed;
      if (remaining <= 0) {
        throw new ConflictError(
          'Prescription item has already been fully dispensed',
          'PRESCRIPTION_ITEM_FULFILLED',
        );
      }
      if (input.quantity > remaining) {
        throw new ConflictError(
          `Requested ${input.quantity} exceeds remaining ${remaining} for this prescription item`,
          'DISPENSE_EXCEEDS_REMAINING',
        );
      }

      const batchLookup = await this.resolveBatch(
        tx,
        schemaIdent,
        itemLookup.medicine_id,
        input.batchId,
      );
      if (batchLookup.quantity_on_hand < input.quantity) {
        throw new ConflictError(
          `Batch has ${batchLookup.quantity_on_hand} on hand; requested ${input.quantity}`,
          'INSUFFICIENT_STOCK',
        );
      }

      const updated = await tx.$queryRaw<Array<{ id: string; quantity_on_hand: number }>>(
        Prisma.sql`
          UPDATE ${schemaIdent}.pharmacy_inventory_batches
          SET quantity_on_hand = quantity_on_hand - ${input.quantity},
              updated_at = NOW()
          WHERE id = ${batchLookup.id}::uuid
            AND quantity_on_hand >= ${input.quantity}
          RETURNING id, quantity_on_hand
        `,
      );
      if (updated.length === 0) {
        throw new ConflictError(
          'Batch stock changed concurrently; please retry',
          'INSUFFICIENT_STOCK',
        );
      }

      const inserted = await tx.$queryRaw<DispenseRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.pharmacy_dispenses (
          prescription_item_id, batch_id, quantity, unit, dispensed_by_user_id, notes
        ) VALUES (
          ${input.prescriptionItemId}::uuid,
          ${batchLookup.id}::uuid,
          ${input.quantity},
          ${batchLookup.unit},
          ${actorUserId},
          ${input.notes ?? null}
        )
        RETURNING *
      `);
      const dispenseRow = inserted[0];
      if (!dispenseRow) throw new Error('Dispense INSERT returned no row');

      return {
        row: dispenseRow,
        item: itemLookup,
        batch: batchLookup,
        remainingAfter: remaining - input.quantity,
      };
    });

    // Audit is intentionally written outside the transaction — it has its own
    // serializable retry loop on the platform.audit_log chain, and we don't
    // want to roll back a successful dispense if the chain tip is contended.
    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'pharmacy.dispense',
      resource: 'prescription',
      resourceId: input.prescriptionItemId,
      outcome: 'SUCCESS',
      payload: {
        batchId: batch.id,
        medicineId: item.medicine_id,
        quantity: input.quantity,
        unit: batch.unit,
        remainingAfter,
      },
    });

    return toDispenseDto(row);
  }

  async listForPrescriptionItem(prescriptionItemId: string): Promise<DispenseDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<DispenseRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.pharmacy_dispenses
      WHERE prescription_item_id = ${prescriptionItemId}::uuid
      ORDER BY dispensed_at DESC
    `);
    return rows.map(toDispenseDto);
  }

  private async lookupPrescriptionItem(
    tx: TxClient,
    schemaIdent: Prisma.Sql,
    prescriptionItemId: string,
  ): Promise<PrescriptionItemLookup> {
    // Lock the item row for the duration of the transaction so concurrent
    // dispenses against the same item serialize behind us. Without FOR UPDATE
    // here two requests could both read the same already_dispensed sum and
    // both pass the remaining-quantity check.
    const rows = await tx.$queryRaw<PrescriptionItemLookup[]>(Prisma.sql`
      SELECT
        i.id,
        i.medicine_id,
        i.quantity_to_dispense,
        p.status AS rx_status,
        COALESCE((
          SELECT SUM(quantity) FROM ${schemaIdent}.pharmacy_dispenses d
          WHERE d.prescription_item_id = i.id
        ), 0)::INTEGER AS already_dispensed
      FROM ${schemaIdent}.prescription_items i
      JOIN ${schemaIdent}.prescriptions p ON p.id = i.prescription_id
      WHERE i.id = ${prescriptionItemId}::uuid
      LIMIT 1
      FOR UPDATE OF i
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('prescription_item', prescriptionItemId);
    return row;
  }

  private async resolveBatch(
    tx: TxClient,
    schemaIdent: Prisma.Sql,
    medicineId: string,
    batchId: string | undefined,
  ): Promise<BatchLookup> {
    if (batchId) {
      const rows = await tx.$queryRaw<BatchLookup[]>(Prisma.sql`
        SELECT id, medicine_id, quantity_on_hand, unit
        FROM ${schemaIdent}.pharmacy_inventory_batches
        WHERE id = ${batchId}::uuid LIMIT 1
      `);
      const row = rows[0];
      if (!row) throw new NotFoundError('pharmacy_inventory', batchId);
      if (row.medicine_id !== medicineId) {
        throw new ConflictError(
          `Batch ${batchId} belongs to a different medicine`,
          'BATCH_MEDICINE_MISMATCH',
        );
      }
      return row;
    }
    // FEFO: first-expiry-first-out among batches with stock.
    const rows = await tx.$queryRaw<BatchLookup[]>(Prisma.sql`
      SELECT id, medicine_id, quantity_on_hand, unit
      FROM ${schemaIdent}.pharmacy_inventory_batches
      WHERE medicine_id = ${medicineId}::uuid
        AND quantity_on_hand > 0
        AND expires_on >= CURRENT_DATE
      ORDER BY expires_on ASC, received_at ASC
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      throw new ConflictError(
        `No in-stock, non-expired batch for medicine ${medicineId}`,
        'NO_BATCH_AVAILABLE',
      );
    }
    return row;
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }
}

export function toDispenseDto(row: DispenseRow): DispenseDto {
  return {
    id: row.id,
    prescriptionItemId: row.prescription_item_id,
    batchId: row.batch_id,
    quantity: row.quantity,
    unit: row.unit,
    dispensedByUserId: row.dispensed_by_user_id,
    dispensedAt: row.dispensed_at.toISOString(),
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}
