import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import {
  AddDiagnosisDto,
  CreateEncounterDto,
  RecordVitalsDto,
  UpdateEncounterDto,
} from './dto/create-encounter.dto';
import { EncounterDiagnosisDto, EncounterDto, VitalsDto } from './dto/encounter.dto';
import { EncountersService } from './encounters.service';

@ApiBearerAuth('bearer')
@ApiTags('encounters')
@Controller('encounters')
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  @RequirePermission('encounter', 'create')
  @Post()
  @ApiOperation({ summary: 'Open a new encounter on a patient.' })
  open(
    @Body() dto: CreateEncounterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EncounterDto> {
    return this.encounters.open(dto, user.userId);
  }

  @RequirePermission('encounter', 'read')
  @Get()
  @ApiOperation({ summary: 'List encounters for a patient (newest first).' })
  @ApiQuery({ name: 'patientId', required: true })
  list(@Query('patientId') patientId: string): Promise<EncounterDto[]> {
    return this.encounters.listForPatient(patientId);
  }

  @RequirePermission('encounter', 'read')
  @Get(':id')
  @ApiOperation({ summary: 'Get one encounter by id (PHI decrypted server-side).' })
  getById(@Param('id') id: string): Promise<EncounterDto> {
    return this.encounters.findById(id);
  }

  @RequirePermission('encounter', 'update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update progress notes, chief complaint, or close the encounter.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEncounterDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EncounterDto> {
    return this.encounters.update(id, dto, user.userId);
  }

  @RequirePermission('encounter', 'update')
  @Post(':id/vitals')
  @ApiOperation({ summary: 'Record a vitals snapshot on an open encounter.' })
  recordVitals(
    @Param('id') id: string,
    @Body() dto: RecordVitalsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VitalsDto> {
    return this.encounters.recordVitals(id, dto, user.userId);
  }

  @RequirePermission('encounter', 'read')
  @Get(':id/vitals')
  @ApiOperation({ summary: 'List vitals snapshots for an encounter.' })
  listVitals(@Param('id') id: string): Promise<VitalsDto[]> {
    return this.encounters.listVitals(id);
  }

  @RequirePermission('encounter', 'update')
  @Post(':id/diagnoses')
  @ApiOperation({ summary: 'Attach an ICD-10 diagnosis to an encounter.' })
  addDiagnosis(
    @Param('id') id: string,
    @Body() dto: AddDiagnosisDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EncounterDiagnosisDto> {
    return this.encounters.addDiagnosis(id, dto, user.userId);
  }

  @RequirePermission('encounter', 'read')
  @Get(':id/diagnoses')
  @ApiOperation({ summary: 'List diagnoses on an encounter.' })
  listDiagnoses(@Param('id') id: string): Promise<EncounterDiagnosisDto[]> {
    return this.encounters.listDiagnoses(id);
  }
}
