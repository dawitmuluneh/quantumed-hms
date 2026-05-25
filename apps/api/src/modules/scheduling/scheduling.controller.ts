import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import {
  CreateAppointmentDto,
  CreateResourceDto,
  CreateScheduleDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentStatusDto,
} from './dto/create-appointment.dto';
import { AppointmentDto, ResourceDto, ScheduleDto } from './dto/scheduling.dto';
import { SchedulingService } from './scheduling.service';

@ApiBearerAuth('bearer')
@ApiTags('scheduling')
@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  // ---------------------------------------------------------------------------
  // Appointments
  // ---------------------------------------------------------------------------

  @RequirePermission('appointment', 'create')
  @Post('appointments')
  @ApiOperation({ summary: 'Book a new appointment. Rejects double-booking via DB-level guard.' })
  book(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentDto> {
    return this.scheduling.bookAppointment(dto, user.userId);
  }

  @RequirePermission('appointment', 'read')
  @Get('appointments')
  @ApiOperation({ summary: 'List appointments by patient/provider/date window.' })
  list(@Query() query: ListAppointmentsQueryDto): Promise<AppointmentDto[]> {
    return this.scheduling.listAppointments(query);
  }

  @RequirePermission('appointment', 'read')
  @Get('appointments/:id')
  @ApiOperation({ summary: 'Get one appointment by id.' })
  getById(@Param('id') id: string): Promise<AppointmentDto> {
    return this.scheduling.findById(id);
  }

  @RequirePermission('appointment', 'update')
  @Patch('appointments/:id/status')
  @ApiOperation({ summary: 'Advance the appointment through the scheduling state machine.' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentDto> {
    return this.scheduling.updateStatus(id, dto, user.userId);
  }

  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------

  @RequirePermission('schedule', 'create')
  @Post('schedules')
  @ApiOperation({ summary: 'Add a weekly availability window for a provider.' })
  createSchedule(
    @Body() dto: CreateScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScheduleDto> {
    return this.scheduling.createSchedule(dto, user.userId);
  }

  @RequirePermission('schedule', 'read')
  @Get('schedules')
  @ApiOperation({ summary: 'List provider schedules (optionally filtered by provider).' })
  listSchedules(@Query('providerUserId') providerUserId?: string): Promise<ScheduleDto[]> {
    return this.scheduling.listSchedules(providerUserId);
  }

  // ---------------------------------------------------------------------------
  // Resources (rooms/beds/equipment)
  // ---------------------------------------------------------------------------

  @RequirePermission('schedule', 'create')
  @Post('resources')
  @ApiOperation({ summary: 'Register a bookable resource (room, bed, equipment).' })
  createResource(
    @Body() dto: CreateResourceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResourceDto> {
    return this.scheduling.createResource(dto, user.userId);
  }

  @RequirePermission('schedule', 'read')
  @Get('resources')
  @ApiOperation({ summary: 'List bookable resources.' })
  listResources(): Promise<ResourceDto[]> {
    return this.scheduling.listResources();
  }
}
