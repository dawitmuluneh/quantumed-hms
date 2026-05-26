import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import { DispensesService } from './dispenses.service';
import {
  CreateDispenseDto,
  CreateMedicineDto,
  ReceiveBatchDto,
  UpdateMedicineDto,
} from './dto/create-medicine.dto';
import { DispenseDto, InventoryBatchDto, MedicineDto } from './dto/pharmacy.dto';
import { MedicinesService } from './medicines.service';
import { PharmacyInventoryService } from './pharmacy-inventory.service';

@ApiBearerAuth('bearer')
@ApiTags('pharmacy')
@Controller('pharmacy')
export class PharmacyController {
  constructor(
    private readonly medicines: MedicinesService,
    private readonly inventory: PharmacyInventoryService,
    private readonly dispenses: DispensesService,
  ) {}

  // --- Medicines catalog ---------------------------------------------------

  @RequirePermission('medicine', 'create')
  @Post('medicines')
  @ApiOperation({ summary: 'Add a medicine to the tenant formulary.' })
  createMedicine(
    @Body() dto: CreateMedicineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MedicineDto> {
    return this.medicines.create(dto, user.userId);
  }

  @RequirePermission('medicine', 'read')
  @Get('medicines')
  @ApiOperation({ summary: 'Search the formulary by code or generic name.' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  listMedicines(
    @Query('search') search?: string,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<MedicineDto[]> {
    return this.medicines.list({ search, activeOnly: activeOnly === 'true' });
  }

  @RequirePermission('medicine', 'read')
  @Get('medicines/:id')
  @ApiOperation({ summary: 'Get one medicine by id.' })
  getMedicine(@Param('id') id: string): Promise<MedicineDto> {
    return this.medicines.findById(id);
  }

  @RequirePermission('medicine', 'update')
  @Patch('medicines/:id')
  @ApiOperation({ summary: 'Update mutable medicine fields (brand, strength, flags).' })
  updateMedicine(
    @Param('id') id: string,
    @Body() dto: UpdateMedicineDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MedicineDto> {
    return this.medicines.update(id, dto, user.userId);
  }

  // --- Inventory batches ---------------------------------------------------

  @RequirePermission('pharmacy_inventory', 'create')
  @Post('inventory/batches')
  @ApiOperation({ summary: 'Record receipt of a new inventory batch.' })
  receiveBatch(
    @Body() dto: ReceiveBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InventoryBatchDto> {
    return this.inventory.receiveBatch(dto, user.userId);
  }

  @RequirePermission('pharmacy_inventory', 'read')
  @Get('inventory/batches')
  @ApiOperation({ summary: 'List inventory batches for a medicine (FEFO order).' })
  @ApiQuery({ name: 'medicineId', required: true })
  listBatches(@Query('medicineId') medicineId: string): Promise<InventoryBatchDto[]> {
    return this.inventory.listForMedicine(medicineId);
  }

  @RequirePermission('pharmacy_inventory', 'read')
  @Get('inventory/batches/:id')
  @ApiOperation({ summary: 'Get one inventory batch by id.' })
  getBatch(@Param('id') id: string): Promise<InventoryBatchDto> {
    return this.inventory.findById(id);
  }

  // --- Dispenses -----------------------------------------------------------

  @RequirePermission('prescription', 'update')
  @Post('dispenses')
  @ApiOperation({
    summary:
      'Dispense a prescription line item. Picks the first-expiring batch when none is specified.',
  })
  dispense(
    @Body() dto: CreateDispenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DispenseDto> {
    return this.dispenses.dispense(dto, user.userId);
  }

  @RequirePermission('prescription', 'read')
  @Get('dispenses')
  @ApiOperation({ summary: 'List dispenses against a prescription item (newest first).' })
  @ApiQuery({ name: 'prescriptionItemId', required: true })
  listDispenses(@Query('prescriptionItemId') prescriptionItemId: string): Promise<DispenseDto[]> {
    return this.dispenses.listForPrescriptionItem(prescriptionItemId);
  }
}
