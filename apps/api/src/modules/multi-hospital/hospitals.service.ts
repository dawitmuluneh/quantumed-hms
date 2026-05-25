import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UsersService } from '../identity/users.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';

import { CreateHospitalDto } from './dto/create-hospital.dto';

export interface CreateHospitalResult {
  id: string;
  slug: string;
  schemaName: string;
  adminEmail?: string;
  /** Returned only at creation time; admin is forced to rotate on first login. */
  adminTempPassword?: string;
}

@Injectable()
export class HospitalsService {
  private readonly logger = new Logger(HospitalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenantProvisioningService,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateHospitalDto, actorUserId: string | null): Promise<CreateHospitalResult> {
    const existing = await this.prisma.hospital.findUnique({ where: { slug: dto.slug } });
    if (existing)
      throw new ConflictError(`Hospital slug already in use: ${dto.slug}`, 'HOSPITAL_SLUG_TAKEN');

    const schemaName = TenantProvisioningService.toSchemaName(dto.slug);

    const hospital = await this.prisma.hospital.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        tier: dto.tier ?? 'STANDARD',
        isolationMode: dto.isolationMode ?? 'SCHEMA',
        schemaName,
        defaultLocale: dto.defaultLocale ?? 'en',
        defaultTimezone: dto.defaultTimezone ?? 'UTC',
        defaultCurrency: dto.defaultCurrency ?? 'USD',
        branding: (dto.branding as object | undefined) ?? undefined,
        status: 'PROVISIONING',
      },
    });

    try {
      await this.tenancy.provisionSchema(schemaName);
    } catch (err) {
      this.logger.error(
        `Schema provisioning failed for ${schemaName}: ${err instanceof Error ? err.message : err}`,
      );
      await this.prisma.hospital.update({
        where: { id: hospital.id },
        data: { status: 'ARCHIVED' },
      });
      throw err;
    }

    let adminTempPassword: string | undefined;
    if (dto.adminEmail) {
      adminTempPassword = randomBytes(9).toString('base64url');
      const passwordHash = await this.users.hashPassword(adminTempPassword);
      const adminRole = await this.prisma.role.findUnique({ where: { code: 'admin' } });
      if (!adminRole) throw new NotFoundError('role', 'admin');
      await this.prisma.user.create({
        data: {
          hospitalId: hospital.id,
          email: dto.adminEmail,
          emailNormalized: UsersService.normalizeEmail(dto.adminEmail),
          passwordHash,
          fullName: dto.adminFullName ?? dto.adminEmail,
          mustRotatePassword: true,
          status: 'ACTIVE',
          roles: { create: { roleId: adminRole.id } },
        },
      });
    }

    await this.prisma.hospital.update({
      where: { id: hospital.id },
      data: { status: 'ACTIVE' },
    });

    await this.audit.write({
      action: 'hospital.create',
      resource: 'hospital',
      resourceId: hospital.id,
      hospitalId: hospital.id,
      actorUserId,
      payload: { slug: hospital.slug, tier: hospital.tier, isolationMode: hospital.isolationMode },
    });

    return {
      id: hospital.id,
      slug: hospital.slug,
      schemaName: hospital.schemaName,
      ...(dto.adminEmail ? { adminEmail: dto.adminEmail } : {}),
      ...(adminTempPassword ? { adminTempPassword } : {}),
    };
  }

  async list() {
    return this.prisma.hospital.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        tier: true,
        isolationMode: true,
        status: true,
        defaultLocale: true,
        defaultTimezone: true,
        defaultCurrency: true,
        createdAt: true,
      },
    });
  }

  async getById(id: string) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id } });
    if (!hospital) throw new NotFoundError('hospital', id);
    return hospital;
  }
}
