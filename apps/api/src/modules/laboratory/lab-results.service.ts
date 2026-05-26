import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import { CreateLabResultDto, VerifyLabResultDto } from './dto/create-lab.dto';
import { LabOrderItemStatus, LabResultDto, LabResultFlag } from './dto/lab.dto';

interface ResultRow {
  id: string;
  lab_order_item_id: string;
  value_numeric: string | number | null;
  value_text: string | null;
  unit: string | null;
  flag: LabResultFlag;
  reference_low: string | number | null;
  reference_high: string | number | null;
  critical_low: string | number | null;
  critical_high: string | number | null;
  observed_at: Date;
  entered_by_user_id: string;
  verified_by_user_id: string | null;
  verified_at: Date | null;
  notes_enc: string | null;
  created_at: Date;
}

interface ItemAndTestRow {
  id: string;
  lab_order_id: string;
  lab_test_id: string;
  status: LabOrderItemStatus;
  unit: string | null;
  reference_low: string | number | null;
  reference_high: string | number | null;
  critical_low: string | number | null;
  critical_high: string | number | null;
}

@Injectable()
export class LabResultsService {
  private readonly logger = new Logger(LabResultsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Enter a result against a lab order item. Three writes happen inside a
   * single $transaction with `SELECT ... FOR UPDATE OF i`:
   *
   *   1. Lock the item row so concurrent submissions serialize.
   *   2. Snapshot reference/critical ranges from lab_tests onto the result
   *      row, so future catalog edits cannot retroactively change a flag.
   *   3. INSERT into lab_results (append-only ledger) and flip the item
   *      status to RESULTED.
   *
   * Numeric values are auto-flagged server-side; text-only values use the
   * caller-supplied flag (or NORMAL).
   */
  async enter(
    labOrderItemId: string,
    input: CreateLabResultDto,
    actorUserId: string,
  ): Promise<LabResultDto> {
    if (input.valueNumeric === undefined && (!input.valueText || input.valueText.length === 0)) {
      throw new ValidationError('One of valueNumeric or valueText must be provided');
    }

    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const notesEnc = input.notes
      ? await this.encryption.encrypt(ctx.hospitalId, input.notes)
      : null;

    const inserted = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ItemAndTestRow[]>(Prisma.sql`
        SELECT i.id, i.lab_order_id, i.lab_test_id, i.status,
               t.unit, t.reference_low, t.reference_high,
               t.critical_low, t.critical_high
        FROM ${schemaIdent}.lab_order_items i
        JOIN ${schemaIdent}.lab_tests t ON t.id = i.lab_test_id
        WHERE i.id = ${labOrderItemId}::uuid
        FOR UPDATE OF i
      `);
      const item = rows[0];
      if (!item) throw new NotFoundError('lab_order_item', labOrderItemId);
      if (item.status === 'VERIFIED' || item.status === 'CANCELLED') {
        throw new ConflictError(
          `Cannot enter result on a ${item.status} item`,
          'LAB_ITEM_TERMINAL',
        );
      }

      const refLow = item.reference_low === null ? null : Number(item.reference_low);
      const refHigh = item.reference_high === null ? null : Number(item.reference_high);
      const critLow = item.critical_low === null ? null : Number(item.critical_low);
      const critHigh = item.critical_high === null ? null : Number(item.critical_high);

      const flag = this.computeFlag({
        valueNumeric: input.valueNumeric,
        valueText: input.valueText,
        inputFlag: input.flag,
        referenceLow: refLow,
        referenceHigh: refHigh,
        criticalLow: critLow,
        criticalHigh: critHigh,
      });

      const insertedResultRows = await tx.$queryRaw<ResultRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.lab_results (
          lab_order_item_id, value_numeric, value_text, unit, flag,
          reference_low, reference_high, critical_low, critical_high,
          observed_at, entered_by_user_id, notes_enc
        ) VALUES (
          ${labOrderItemId}::uuid,
          ${input.valueNumeric ?? null},
          ${input.valueText ?? null},
          ${input.unit ?? item.unit ?? null},
          ${flag},
          ${refLow},
          ${refHigh},
          ${critLow},
          ${critHigh},
          NOW(),
          ${actorUserId},
          ${notesEnc}
        )
        RETURNING *
      `);
      const insertedRow = insertedResultRows[0];
      if (!insertedRow) throw new Error('lab_results INSERT returned no row');

      await tx.$queryRaw(Prisma.sql`
        UPDATE ${schemaIdent}.lab_order_items
        SET status = 'RESULTED', updated_at = NOW()
        WHERE id = ${labOrderItemId}::uuid
      `);

      return insertedRow;
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_result.enter',
      resource: 'lab_result',
      resourceId: inserted.id,
      outcome: 'SUCCESS',
      payload: {
        labOrderItemId,
        flag: inserted.flag,
        hasNumeric: inserted.value_numeric !== null,
      },
    });

    return this.toDto(ctx.hospitalId, inserted);
  }

  /**
   * Verify a previously entered result. Runs in a single transaction that
   * locks both the result row and its item row. Rejects self-verification
   * (the verifier must differ from the entering technician).
   */
  async verify(
    resultId: string,
    input: VerifyLabResultDto,
    actorUserId: string,
  ): Promise<LabResultDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const verifierId = input.verifiedByUserId ?? actorUserId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const resultRows = await tx.$queryRaw<ResultRow[]>(Prisma.sql`
        SELECT * FROM ${schemaIdent}.lab_results
        WHERE id = ${resultId}::uuid
        FOR UPDATE
      `);
      const result = resultRows[0];
      if (!result) throw new NotFoundError('lab_result', resultId);
      if (result.verified_at !== null) {
        throw new ConflictError('Lab result is already verified', 'LAB_RESULT_ALREADY_VERIFIED');
      }
      if (result.entered_by_user_id === verifierId) {
        throw new ConflictError(
          'A lab result cannot be verified by the same user who entered it',
          'LAB_RESULT_SELF_VERIFY',
        );
      }

      // Latest-result-only verification: enforce that this is the most recent
      // result for its item. Re-entries would otherwise allow verifying an
      // older value while a newer one sits unverified.
      const latestRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM ${schemaIdent}.lab_results
        WHERE lab_order_item_id = ${result.lab_order_item_id}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `);
      if (latestRows[0]?.id !== resultId) {
        throw new ConflictError(
          'Only the latest result for an item may be verified',
          'LAB_RESULT_NOT_LATEST',
        );
      }

      const itemLock = await tx.$queryRaw<Array<{ id: string; status: LabOrderItemStatus }>>(
        Prisma.sql`
          SELECT id, status FROM ${schemaIdent}.lab_order_items
          WHERE id = ${result.lab_order_item_id}::uuid
          FOR UPDATE
        `,
      );
      const itemRow = itemLock[0];
      if (!itemRow) throw new NotFoundError('lab_order_item', result.lab_order_item_id);
      if (itemRow.status !== 'RESULTED') {
        throw new ConflictError(
          `Cannot verify a result whose item is in status ${itemRow.status}`,
          'LAB_ITEM_NOT_RESULTED',
        );
      }

      const verifiedRows = await tx.$queryRaw<ResultRow[]>(Prisma.sql`
        UPDATE ${schemaIdent}.lab_results
        SET verified_by_user_id = ${verifierId},
            verified_at = NOW()
        WHERE id = ${resultId}::uuid
          AND verified_at IS NULL
        RETURNING *
      `);
      const verified = verifiedRows[0];
      if (!verified) {
        throw new ConflictError(
          'Lab result was verified concurrently; please reload and retry',
          'LAB_RESULT_VERIFY_CONFLICT',
        );
      }

      await tx.$queryRaw(Prisma.sql`
        UPDATE ${schemaIdent}.lab_order_items
        SET status = 'VERIFIED', updated_at = NOW()
        WHERE id = ${result.lab_order_item_id}::uuid
      `);

      return verified;
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_result.verify',
      resource: 'lab_result',
      resourceId: updated.id,
      outcome: 'SUCCESS',
      payload: {
        labOrderItemId: updated.lab_order_item_id,
        verifiedByUserId: verifierId,
        flag: updated.flag,
      },
    });

    return this.toDto(ctx.hospitalId, updated);
  }

  async findById(id: string): Promise<LabResultDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ResultRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.lab_results WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('lab_result', id);
    return this.toDto(ctx.hospitalId, row);
  }

  async listForItem(labOrderItemId: string): Promise<LabResultDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ResultRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.lab_results
      WHERE lab_order_item_id = ${labOrderItemId}::uuid
      ORDER BY created_at DESC
    `);
    return Promise.all(rows.map((r) => this.toDto(ctx.hospitalId, r)));
  }

  private computeFlag(opts: {
    valueNumeric?: number;
    valueText?: string;
    inputFlag?: LabResultFlag;
    referenceLow: number | null;
    referenceHigh: number | null;
    criticalLow: number | null;
    criticalHigh: number | null;
  }): LabResultFlag {
    if (opts.valueNumeric === undefined) {
      return opts.inputFlag ?? 'NORMAL';
    }
    const v = opts.valueNumeric;
    if (opts.criticalLow !== null && v < opts.criticalLow) return 'CRITICAL_LOW';
    if (opts.criticalHigh !== null && v > opts.criticalHigh) return 'CRITICAL_HIGH';
    if (opts.referenceLow !== null && v < opts.referenceLow) return 'LOW';
    if (opts.referenceHigh !== null && v > opts.referenceHigh) return 'HIGH';
    return 'NORMAL';
  }

  private async toDto(hospitalId: string, row: ResultRow): Promise<LabResultDto> {
    const notes = row.notes_enc ? await this.encryption.decrypt(hospitalId, row.notes_enc) : null;
    return {
      id: row.id,
      labOrderItemId: row.lab_order_item_id,
      valueNumeric: row.value_numeric === null ? null : Number(row.value_numeric),
      valueText: row.value_text,
      unit: row.unit,
      flag: row.flag,
      referenceLow: row.reference_low === null ? null : Number(row.reference_low),
      referenceHigh: row.reference_high === null ? null : Number(row.reference_high),
      criticalLow: row.critical_low === null ? null : Number(row.critical_low),
      criticalHigh: row.critical_high === null ? null : Number(row.critical_high),
      observedAt: row.observed_at.toISOString(),
      enteredByUserId: row.entered_by_user_id,
      verifiedByUserId: row.verified_by_user_id,
      verifiedAt: row.verified_at?.toISOString() ?? null,
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
