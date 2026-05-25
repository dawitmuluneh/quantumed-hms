import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import {
  CreateDependentDto,
  CreatePatientDto,
  ListPatientsQueryDto,
  UpdatePatientDto,
} from './dto/create-patient.dto';
import { DependentDto, PatientDto } from './dto/patient.dto';
import { ListPatientsResult, PatientsService } from './patients.service';

@ApiBearerAuth('bearer')
@ApiTags('patients')
@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @RequirePermission('patient', 'create')
  @Post()
  @ApiOperation({ summary: 'Register a new patient in the current tenant.' })
  register(
    @Body() dto: CreatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientDto> {
    return this.patients.register(dto, user.userId);
  }

  @RequirePermission('patient', 'read')
  @Get()
  @ApiOperation({ summary: 'List patients (cursor-paginated, newest first).' })
  list(@Query() query: ListPatientsQueryDto): Promise<ListPatientsResult> {
    return this.patients.list(query);
  }

  @RequirePermission('patient', 'read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a patient by id (PHI decrypted server-side).' })
  getById(@Param('id') id: string): Promise<PatientDto> {
    return this.patients.findById(id);
  }

  @RequirePermission('patient', 'update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update demographic or PHI fields on a patient.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PatientDto> {
    return this.patients.update(id, dto, user.userId);
  }

  @RequirePermission('patient', 'read')
  @Get(':id/dependents')
  @ApiOperation({ summary: 'List dependents of a patient.' })
  listDependents(@Param('id') id: string): Promise<DependentDto[]> {
    return this.patients.listDependents(id);
  }

  @RequirePermission('patient', 'update')
  @Post(':id/dependents')
  @ApiOperation({ summary: 'Add a dependent (child/spouse/parent) under a patient.' })
  addDependent(
    @Param('id') id: string,
    @Body() dto: CreateDependentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DependentDto> {
    return this.patients.addDependent(id, dto, user.userId);
  }
}
