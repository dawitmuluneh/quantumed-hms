import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

import {
  CreateAppointmentDto,
  CreateResourceDto,
  CreateScheduleDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentStatusDto,
} from './dto/create-appointment.dto';
import {
  AppointmentDto,
  AppointmentStatus,
  ResourceDto,
  ResourceType,
  ScheduleDto,
} from './dto/scheduling.dto';

interface AppointmentRow {
  id: string;
  patient_id: string;
  provider_user_id: string;
  resource_id: string | null;
  scheduled_start: Date;
  scheduled_end: Date;
  status: AppointmentStatus;
  reason: string | null;
  notes_enc: string | null;
  encounter_id: string | null;
  created_by_user_id: string | null;
  cancelled_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ScheduleRow {
  id: string;
  provider_user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  effective_from: Date | null;
  effective_until: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ResourceRow {
  id: string;
  code: string;
  name: string;
  resource_type: ResourceType;
  location: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Status transitions allowed by the scheduling service. Server-side state
 * machine; anything not in this map is rejected.
 */
const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditLogService,
  ) {}

  async bookAppointment(input: CreateAppointmentDto, actorUserId: string): Promise<AppointmentDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);
    if (!(start < end)) {
      throw new ValidationError('scheduledEnd must be after scheduledStart');
    }

    // Patient must exist in this tenant.
    const patient = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM ${schemaIdent}.patients WHERE id = ${input.patientId}::uuid LIMIT 1`,
    );
    if (patient.length === 0) throw new NotFoundError('patient', input.patientId);

    const notesEnc = input.notes
      ? await this.encryption.encrypt(ctx.hospitalId, input.notes)
      : null;

    try {
      const rows = await this.prisma.$queryRaw<AppointmentRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.appointments (
          patient_id, provider_user_id, resource_id,
          scheduled_start, scheduled_end, status,
          reason, notes_enc, created_by_user_id
        ) VALUES (
          ${input.patientId}::uuid,
          ${input.providerUserId},
          ${input.resourceId ? Prisma.sql`${input.resourceId}::uuid` : Prisma.sql`NULL`},
          ${input.scheduledStart}::timestamptz,
          ${input.scheduledEnd}::timestamptz,
          'SCHEDULED',
          ${input.reason ?? null},
          ${notesEnc},
          ${actorUserId}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('Appointment INSERT returned no row');

      await this.audit.write({
        hospitalId: ctx.hospitalId,
        actorUserId,
        action: 'appointment.book',
        resource: 'appointment',
        resourceId: row.id,
        outcome: 'SUCCESS',
        payload: {
          patientId: input.patientId,
          providerUserId: input.providerUserId,
          scheduledStart: input.scheduledStart,
          scheduledEnd: input.scheduledEnd,
        },
      });

      return this.decryptAppointment(ctx.hospitalId, row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2010' &&
        (err.message ?? '').includes('appointments_provider_no_overlap')
      ) {
        throw new ConflictError(
          'Provider already has an overlapping appointment in this slot',
          'APPOINTMENT_SLOT_TAKEN',
        );
      }
      throw err;
    }
  }

  async findById(id: string): Promise<AppointmentDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<AppointmentRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.appointments WHERE id = ${id}::uuid LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('appointment', id);
    return this.decryptAppointment(ctx.hospitalId, row);
  }

  async listAppointments(query: ListAppointmentsQueryDto): Promise<AppointmentDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const filters: Prisma.Sql[] = [];
    if (query.from) filters.push(Prisma.sql`scheduled_start >= ${query.from}::timestamptz`);
    if (query.to) filters.push(Prisma.sql`scheduled_start < ${query.to}::timestamptz`);
    if (query.providerUserId) filters.push(Prisma.sql`provider_user_id = ${query.providerUserId}`);
    if (query.patientId) filters.push(Prisma.sql`patient_id = ${query.patientId}::uuid`);
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);

    const where =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<AppointmentRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.appointments
      ${where}
      ORDER BY scheduled_start ASC
      LIMIT 500
    `);
    return Promise.all(rows.map((row) => this.decryptAppointment(ctx.hospitalId, row)));
  }

  async updateStatus(
    id: string,
    input: UpdateAppointmentStatusDto,
    actorUserId: string,
  ): Promise<AppointmentDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const existing = await this.prisma.$queryRaw<AppointmentRow[]>(
      Prisma.sql`SELECT * FROM ${schemaIdent}.appointments WHERE id = ${id}::uuid LIMIT 1`,
    );
    const current = existing[0];
    if (!current) throw new NotFoundError('appointment', id);

    const allowed = STATUS_TRANSITIONS[current.status];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Illegal status transition ${current.status} -> ${input.status}`,
        'APPOINTMENT_STATUS_INVALID',
      );
    }
    if (input.status === 'CANCELLED' && !input.cancelledReason) {
      throw new ValidationError('cancelledReason is required when cancelling');
    }

    const rows = await this.prisma.$queryRaw<AppointmentRow[]>(Prisma.sql`
      UPDATE ${schemaIdent}.appointments
      SET status = ${input.status},
          cancelled_reason = ${input.cancelledReason ?? null},
          updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new NotFoundError('appointment', id);

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: `appointment.${input.status.toLowerCase()}`,
      resource: 'appointment',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { from: current.status, to: input.status },
    });

    return this.decryptAppointment(ctx.hospitalId, row);
  }

  // ---------------------------------------------------------------------------
  // Schedules (provider availability)
  // ---------------------------------------------------------------------------

  async createSchedule(input: CreateScheduleDto, actorUserId: string): Promise<ScheduleDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    const rows = await this.prisma.$queryRaw<ScheduleRow[]>(Prisma.sql`
      INSERT INTO ${schemaIdent}.schedules (
        provider_user_id, day_of_week, start_time, end_time,
        effective_from, effective_until, is_active
      ) VALUES (
        ${input.providerUserId},
        ${input.dayOfWeek},
        ${input.startTime}::time,
        ${input.endTime}::time,
        ${input.effectiveFrom ? Prisma.sql`${input.effectiveFrom}::date` : Prisma.sql`NULL`},
        ${input.effectiveUntil ? Prisma.sql`${input.effectiveUntil}::date` : Prisma.sql`NULL`},
        ${input.isActive ?? true}
      )
      RETURNING *
    `);
    const row = rows[0];
    if (!row) throw new Error('Schedule INSERT returned no row');

    await this.audit.write({
      hospitalId: ctx.hospitalId,
      actorUserId,
      action: 'schedule.create',
      resource: 'schedule',
      resourceId: row.id,
      outcome: 'SUCCESS',
      payload: { providerUserId: input.providerUserId, dayOfWeek: input.dayOfWeek },
    });

    return toScheduleDto(row);
  }

  async listSchedules(providerUserId?: string): Promise<ScheduleDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const where = providerUserId
      ? Prisma.sql`WHERE provider_user_id = ${providerUserId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ScheduleRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.schedules
      ${where}
      ORDER BY provider_user_id, day_of_week, start_time
    `);
    return rows.map(toScheduleDto);
  }

  // ---------------------------------------------------------------------------
  // Resources (rooms, beds, equipment)
  // ---------------------------------------------------------------------------

  async createResource(input: CreateResourceDto, actorUserId: string): Promise<ResourceDto> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);

    try {
      const rows = await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
        INSERT INTO ${schemaIdent}.resources (
          code, name, resource_type, location, is_active
        ) VALUES (
          ${input.code}, ${input.name}, ${input.resourceType},
          ${input.location ?? null}, ${input.isActive ?? true}
        )
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('Resource INSERT returned no row');

      await this.audit.write({
        hospitalId: ctx.hospitalId,
        actorUserId,
        action: 'resource.create',
        resource: 'schedule',
        resourceId: row.id,
        outcome: 'SUCCESS',
        payload: { code: row.code, resourceType: row.resource_type },
      });

      return toResourceDto(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2010' &&
        (err.message ?? '').includes('resources_code_uq')
      ) {
        throw new ConflictError(
          `Resource code already in use: ${input.code}`,
          'RESOURCE_CODE_TAKEN',
        );
      }
      throw err;
    }
  }

  async listResources(): Promise<ResourceDto[]> {
    const ctx = this.tenant.getTenant();
    const schemaIdent = this.schemaIdent(ctx.schemaName);
    const rows = await this.prisma.$queryRaw<ResourceRow[]>(Prisma.sql`
      SELECT * FROM ${schemaIdent}.resources
      ORDER BY resource_type, code
    `);
    return rows.map(toResourceDto);
  }

  private schemaIdent(schemaName: string): Prisma.Sql {
    if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
      throw new Error(`Refusing to query invalid schema: ${schemaName}`);
    }
    return Prisma.raw(`"${schemaName}"`);
  }

  private async decryptAppointment(
    hospitalId: string,
    row: AppointmentRow,
  ): Promise<AppointmentDto> {
    const notes = row.notes_enc ? await this.encryption.decrypt(hospitalId, row.notes_enc) : null;
    return {
      id: row.id,
      patientId: row.patient_id,
      providerUserId: row.provider_user_id,
      resourceId: row.resource_id,
      scheduledStart: row.scheduled_start.toISOString(),
      scheduledEnd: row.scheduled_end.toISOString(),
      status: row.status,
      reason: row.reason,
      notes,
      encounterId: row.encounter_id,
      createdByUserId: row.created_by_user_id,
      cancelledReason: row.cancelled_reason,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

export { STATUS_TRANSITIONS };

function toScheduleDto(row: ScheduleRow): ScheduleDto {
  return {
    id: row.id,
    providerUserId: row.provider_user_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    effectiveFrom: row.effective_from?.toISOString() ?? null,
    effectiveUntil: row.effective_until?.toISOString() ?? null,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toResourceDto(row: ResourceRow): ResourceDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    resourceType: row.resource_type,
    location: row.location,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
