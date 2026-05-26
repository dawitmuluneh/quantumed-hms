import { Module } from '@nestjs/common';

import { DispensesService } from './dispenses.service';
import { MedicinesService } from './medicines.service';
import { PharmacyInventoryService } from './pharmacy-inventory.service';
import { PharmacyController } from './pharmacy.controller';

@Module({
  controllers: [PharmacyController],
  providers: [MedicinesService, PharmacyInventoryService, DispensesService],
  exports: [MedicinesService, PharmacyInventoryService, DispensesService],
})
export class PharmacyModule {}
