import { Module } from '@nestjs/common';

import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';
import { LabTestsService } from './lab-tests.service';
import { LaboratoryController } from './laboratory.controller';

@Module({
  controllers: [LaboratoryController],
  providers: [LabTestsService, LabOrdersService, LabResultsService],
  exports: [LabTestsService, LabOrdersService, LabResultsService],
})
export class LaboratoryModule {}
