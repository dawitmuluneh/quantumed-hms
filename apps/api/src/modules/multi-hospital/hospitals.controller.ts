import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { SkipTenant } from '../../common/tenant/skip-tenant.decorator';

import { CreateHospitalDto } from './dto/create-hospital.dto';
import { CreateHospitalResult, HospitalsService } from './hospitals.service';

@ApiBearerAuth('bearer')
@ApiTags('hospitals')
@SkipTenant()
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitals: HospitalsService) {}

  @RequirePermission('hospital', 'create')
  @Post()
  @ApiOperation({ summary: 'Super Admin: provision a new hospital tenant.' })
  create(
    @Body() dto: CreateHospitalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreateHospitalResult> {
    return this.hospitals.create(dto, user.userId);
  }

  @RequirePermission('hospital', 'read')
  @Get()
  @ApiOperation({ summary: 'List hospitals visible to the caller.' })
  list() {
    return this.hospitals.list();
  }

  @RequirePermission('hospital', 'read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a hospital by id.' })
  getById(@Param('id') id: string) {
    return this.hospitals.getById(id);
  }
}
