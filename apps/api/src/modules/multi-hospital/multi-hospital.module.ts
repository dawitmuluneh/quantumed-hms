import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { TenancyModule } from '../tenancy/tenancy.module';

import { HospitalsController } from './hospitals.controller';
import { HospitalsService } from './hospitals.service';

@Module({
  imports: [IdentityModule, TenancyModule],
  controllers: [HospitalsController],
  providers: [HospitalsService],
  exports: [HospitalsService],
})
export class MultiHospitalModule {}
