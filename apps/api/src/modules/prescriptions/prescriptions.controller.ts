import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import { CreatePrescriptionDto, UpdatePrescriptionStatusDto } from './dto/create-prescription.dto';
import { PrescriptionDto } from './dto/prescription.dto';
import { PrescriptionsService } from './prescriptions.service';

@ApiBearerAuth('bearer')
@ApiTags('prescriptions')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @RequirePermission('prescription', 'create')
  @Post()
  @ApiOperation({ summary: 'Write a new prescription against an open encounter.' })
  create(
    @Body() dto: CreatePrescriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrescriptionDto> {
    return this.prescriptions.create(dto, user.userId);
  }

  @RequirePermission('prescription', 'read')
  @Get()
  @ApiOperation({
    summary: 'List prescriptions filtered by encounter or patient (newest first).',
  })
  @ApiQuery({ name: 'encounterId', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  list(
    @Query('encounterId') encounterId?: string,
    @Query('patientId') patientId?: string,
  ): Promise<PrescriptionDto[]> {
    if (encounterId) return this.prescriptions.listForEncounter(encounterId);
    if (patientId) return this.prescriptions.listForPatient(patientId);
    return Promise.resolve([]);
  }

  @RequirePermission('prescription', 'read')
  @Get(':id')
  @ApiOperation({ summary: 'Get one prescription by id (PHI decrypted server-side).' })
  getById(@Param('id') id: string): Promise<PrescriptionDto> {
    return this.prescriptions.findById(id);
  }

  @RequirePermission('prescription', 'update')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition the prescription status (complete, cancel, supersede).' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePrescriptionStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PrescriptionDto> {
    return this.prescriptions.updateStatus(id, dto, user.userId);
  }
}
