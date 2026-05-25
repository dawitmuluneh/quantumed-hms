import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';

import { AuditModule } from './common/audit/audit.module';
import { configuration } from './common/config/configuration';
import { configValidation } from './common/config/validation';
import { EncryptionModule } from './common/encryption/encryption.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RbacModule } from './common/rbac/rbac.module';
import { TenantModule } from './common/tenant/tenant.module';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { MultiHospitalModule } from './modules/multi-hospital/multi-hospital.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: configValidation,
    }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    EncryptionModule,
    AuditModule,
    RbacModule,
    TenantModule,
    IdentityModule,
    TenancyModule,
    MultiHospitalModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
