import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  CreateLabOrderDto,
  CreateLabOrderItemDto,
  UpdateLabOrderStatusDto,
} from './dto/create-lab.dto';
import {
  LabOrderDto,
  LabOrderItemDto,
  LabOrderItemStatus,
  LabOrderPriority,
  LabOrderStatus,
  LabResultDto,
  LabResultFlag,
} from './dto/lab.dto';

type TxClient = Pick<PrismaService, '$queryRaw'>;

interface LabOrderRow {
  id: string;
  encounter_id: string;
  patient_id: string;
  ordered_by_user_id: string;
  priority: LabOrderPriority;
  status: LabOrderStatus;
  sample_barcode: string;
  notes_enc: string | null;
  ordered_at: Date;
  collected_at: Date | null;
  completed_at: Date | null;
  cancelled_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LabOrderItemRow {
  id: string;
  lab_order_id: string;
  lab_test_id: string;
  status: LabOrderItemStatus;
  instructions_enc: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LatestResultRow {
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

/**
 * Allowed lab-order status transitions. CANCELLED is reachable from any
 * non-terminal state with a reason; COMPLETED is the linear sink and
 * requires every item to have reached VERIFIED or CANCELLED.
 */
const STATUS_TRANSITIONS: Record<LabOrderStatus, LabOrderStatus[]> = {
  PENDING_COLLECTION: ['COLLECTED', 'CANCELLED'],
  COLLECTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class LabOrdersService {
  private readonly logger = new Logger(LabOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async create(input: CreateLabOrderDto, actorUserId: string): Promise<LabOrderDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const orderedBy = input.orderedByUserId ?? actorUserId;
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

    const dedupedTestIds = new Set(input.items.map((i) => i.labTestId));
    if (dedupedTestIds.size !== input.items.length) {
      throw new ValidationError('Duplicate labTestId in items; each test may appear at most once.');
    }

    const { header, itemRows } = await this.prisma.$transaction(async (tx) => {
      const encounter = await tx.$queryRaw<
        Array<{ id: string; patient_id: string; status: string }>
      >(Prisma.sql`
        SELECT id, patient_id, status FROM ${schemaIdent}.encounters
        WHERE id = ${input.encounterId}::uuid LIMIT 1
      `);
      const enc = encounter[0];
      if (!enc) throw new NotFoundError('encounter', input.encounterId);
      if (enc.status !== 'OPEN') {
        throw new ConflictError(
          `Cannot order labs on a ${enc.status} encounter`,
          'ENCOUNTER_NOT_OPEN',
        );
      }

      const testIds = Array.from(dedupedTestIds);
      const tests = await tx.$queryRaw<Array<{ id: string; is_active: boolean }>>(Prisma.sql`
        SELECT id, is_active FROM ${schemaIdent}.lab_tests
        WHERE id::text = ANY(${testIds})
      `);
      const found = new Map(tests.map((t) => [t.id, t]));
      for (const id of testIds) {
        const t = found.get(id);
        if (!t) throw new NotFoundError('lab_test', id);
        if (!t.is_active) {
          throw new ValidationError(`Cannot order inactive lab test: ${id}`);
        }
      }

      const headerRows = await tx.$queryRaw<LabOrderRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.lab_orders (
          encounter_id, patient_id, ordered_by_user_id, priority,
          status, sample_barcode, notes_enc, ordered_at
        ) VALUES (
          ${input.encounterId}::uuid,
          ${enc.patient_id}::uuid,
          ${orderedBy},
          ${input.priority ?? 'ROUTINE'},
          'PENDING_COLLECTION',
          ${input.sampleBarcode},
          ${notesEnc},
          NOW()
        )
        RETURNING *
      `);
      const headerRow = headerRows[0];
      if (!headerRow) throw new Error('lab_orders INSERT returned no row');

      const inserted = await this.insertItems(tx, schemaIdent, headerRow.id, itemPayloads);
      return { header: headerRow, itemRows: inserted };
    });

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_order.create',
      resource: 'lab_order',
      resourceId: header.id,
      outcome: 'SUCCESS',
      payload: {
        encounterId: input.encounterId,
        patientId: header.patient_id,
        priority: header.priority,
        itemCount: itemRows.length,
        sampleBarcode: header.sample_barcode,
      },
    });

    return this.assemble(ctx.hospitalId, header, itemRows, []);
  }

  async findById(id: string): Promise<LabOrderDto> {
    const ctx = this.tenant.getTenant();
    return this.fetch(ctx.hospitalId, ctx.schemaName, id);
  }

  async listForEncounter(encounterId: string): Promise<LabOrderDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const headers = await this.prisma.$queryRaw<LabOrderRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.lab_orders
      WHERE encounter_id = ${encounterId}::uuid
      ORDER BY ordered_at DESC
    `);
    return Promise.all(headers.map((h) => this.fetchWithHeader(ctx.hospitalId, schemaIdent, h)));
  }

  async listForPatient(patientId: string): Promise<LabOrderDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const headers = await this.prisma.$queryRaw<LabOrderRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.lab_orders
      WHERE patient_id = ${patientId}::uuid
      ORDER BY ordered_at DESC
      LIMIT 200
    `);
    return Promise.all(headers.map((h) => this.fetchWithHeader(ctx.hospitalId, schemaIdent, h)));
  }

  async updateStatus(
    id: string,
    input: UpdateLabOrderStatusDto,
    actorUserId: string,
  ): Promise<LabOrderDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const current = await this.prisma.$queryRaw<Array<{ id: string; status: LabOrderStatus }>>(
      Prisma.sql`SELECT id, status FROM ${schemaIdent}.lab_orders WHERE id = ${id}::uuid LIMIT 1`,
    );
    const existing = current[0];
    if (!existing) throw new NotFoundError('lab_order', id);

    const allowed = STATUS_TRANSITIONS[existing.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition lab order from ${existing.status} to ${input.status}`,
        'LAB_ORDER_TRANSITION_INVALID',
      );
    }
    if (input.status === 'CANCELLED' && !input.cancelledReason) {
      throw new ValidationError('cancelledReason is required when status=CANCELLED');
    }

    // Closing the order requires every item to have reached a terminal state
    // (VERIFIED or CANCELLED). Items in PENDING / IN_PROGRESS / RESULTED would
    // leave a closed order with unfinished work.
    if (input.status === 'COMPLETED') {
      const open = await this.prisma.$queryRaw<Array<{ count: bigint | string }>>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM ${schemaIdent}.lab_order_items
        WHERE lab_order_id = ${id}::uuid
          AND status NOT IN ('VERIFIED', 'CANCELLED')
      `);
      const remaining = Number(open[0]?.count ?? 0);
      if (remaining > 0) {
        throw new ConflictError(
          `Cannot complete lab order: ${remaining} item(s) still open`,
          'LAB_ORDER_ITEMS_OPEN',
        );
      }
    }

    // Compare-and-swap on `status`. A concurrent transition that races us out
    // (e.g. CANCELLED winning while we tried COMPLETED) leaves zero rows
    // updated; surface a 409 so the caller reloads and retries.
    const headerRows = await this.prisma.$queryRaw<LabOrderRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.lab_orders
      SET status = ${input.status},
          cancelled_reason = ${input.cancelledReason ?? null},
          collected_at = CASE WHEN ${input.status} = 'COLLECTED' AND collected_at IS NULL
                              THEN NOW() ELSE collected_at END,
          completed_at = CASE WHEN ${input.status} = 'COMPLETED' AND completed_at IS NULL
                              THEN NOW() ELSE completed_at END,
          updated_at = NOW()
      WHERE id = ${id}::uuid
        AND status = ${existing.status}
      RETURNING *
    `);
    const header = headerRows[0];
    if (!header) {
      throw new ConflictError(
        'Lab order status was modified concurrently; please reload and retry',
        'LAB_ORDER_TRANSITION_CONFLICT',
      );
    }

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'lab_order.status.update',
      resource: 'lab_order',
      resourceId: header.id,
      outcome: 'SUCCESS',
      payload: {
        from: existing.status,
        to: input.status,
        cancelledReason: input.cancelledReason ?? null,
      },
    });

    return this.fetch(ctx.hospitalId, ctx.schemaName, header.id);
  }

  private async fetch(hospitalId: string, schemaName: string, id: string): Promise<LabOrderDto> {
    const schemaIdent = this.schemaIdent(schemaName);
    const headerRows = await this.prisma.$queryRaw<LabOrderRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.lab_orders WHERE id = ${id}::uuid LIMIT 1`,
    );
    const header = headerRows[0];
    if (!header) throw new NotFoundError('lab_order', id);
    return this.fetchWithHeader(hospitalId, schemaIdent, header);
  }

  private async fetchWithHeader(
    hospitalId: string,
    schemaIdent: Prisma.Sql,
    header: LabOrderRow,
  ): Promise<LabOrderDto> {
    const items = await this.prisma.$queryRaw<LabOrderItemRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.lab_order_items
      WHERE lab_order_id = ${header.id}::uuid
      ORDER BY created_at ASC
    `);
    const latestResults =
      items.length > 0
        ? await this.prisma.$queryRaw<LatestResultRow[]>(Prisma.sql`
            SELECT DISTINCT ON (lab_order_item_id) *
            FROM ${schemaIdent}.lab_results
            WHERE lab_order_item_id::text = ANY(${items.map((i) => i.id)})
            ORDER BY lab_order_item_id, created_at DESC
          `)
        : [];
    return this.assemble(hospitalId, header, items, latestResults);
  }

  private async insertItems(
    tx: TxClient,
    schemaIdent: Prisma.Sql,
    labOrderId: string,
    items: Array<{ item: CreateLabOrderItemDto; instructionsEnc: string | null }>,
  ): Promise<LabOrderItemRow[]> {
    const out: LabOrderItemRow[] = [];
    for (const { item, instructionsEnc } of items) {
      const rows = await tx.$queryRaw<LabOrderItemRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.lab_order_items (
          lab_order_id, lab_test_id, status, instructions_enc
        ) VALUES (
          ${labOrderId}::uuid,
          ${item.labTestId}::uuid,
          'PENDING',
          ${instructionsEnc}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('lab_order_items INSERT returned no row');
      out.push(row);
    }
    return out;
  }

  private async assemble(
    hospitalId: string,
    header: LabOrderRow,
    items: LabOrderItemRow[],
    latestResults: LatestResultRow[],
  ): Promise<LabOrderDto> {
    const notes = header.notes_enc
      ? await this.encryption.decrypt(hospitalId, header.notes_enc)
      : null;
    const latestByItem = new Map<string, LatestResultRow>();
    for (const r of latestResults) latestByItem.set(r.lab_order_item_id, r);
    const decryptedItems = await Promise.all(
      items.map(async (item) =>
        this.decryptItem(hospitalId, item, latestByItem.get(item.id) ?? null),
      ),
    );
    return {
      id: header.id,
      encounterId: header.encounter_id,
      patientId: header.patient_id,
      orderedByUserId: header.ordered_by_user_id,
      priority: header.priority,
      status: header.status,
      sampleBarcode: header.sample_barcode,
      notes,
      orderedAt: header.ordered_at.toISOString(),
      collectedAt: header.collected_at?.toISOString() ?? null,
      completedAt: header.completed_at?.toISOString() ?? null,
      cancelledReason: header.cancelled_reason,
      createdAt: header.created_at.toISOString(),
      updatedAt: header.updated_at.toISOString(),
      items: decryptedItems,
    };
  }

  private async decryptItem(
    hospitalId: string,
    row: LabOrderItemRow,
    latest: LatestResultRow | null,
  ): Promise<LabOrderItemDto> {
    const instructions = row.instructions_enc
      ? await this.encryption.decrypt(hospitalId, row.instructions_enc)
      : null;
    return {
      id: row.id,
      labOrderId: row.lab_order_id,
      labTestId: row.lab_test_id,
      status: row.status,
      instructions,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      latestResult: latest ? await this.toResultDto(hospitalId, latest) : null,
    };
  }

  private async toResultDto(hospitalId: string, row: LatestResultRow): Promise<LabResultDto> {
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
