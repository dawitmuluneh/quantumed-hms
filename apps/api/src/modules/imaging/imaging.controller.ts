import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import {
  CreateImagingReportDto,
  CreateImagingRequestDto,
  CreateImagingStudyDto,
  UpdateImagingReportDto,
  UpdateImagingReportStatusDto,
  UpdateImagingRequestStatusDto,
} from './dto/create-imaging.dto';
import { ImagingReportDto, ImagingRequestDto, ImagingStudyDto } from './dto/imaging.dto';
import { ImagingReportsService } from './imaging-reports.service';
import { ImagingRequestsService } from './imaging-requests.service';
import { ImagingStudiesService } from './imaging-studies.service';

@ApiBearerAuth('bearer')
@ApiTags('imaging')
@Controller()
export class ImagingController {
  constructor(
    private readonly requests: ImagingRequestsService,
    private readonly studies: ImagingStudiesService,
    private readonly reports: ImagingReportsService,
  ) {}

  // --- Requests ------------------------------------------------------------

  @RequirePermission('imaging_request', 'create')
  @Post('imaging-requests')
  @ApiOperation({ summary: 'Order an imaging study against an open encounter.' })
  createRequest(
    @Body() dto: CreateImagingRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingRequestDto> {
    return this.requests.create(dto, user.userId);
  }

  @RequirePermission('imaging_request', 'read')
  @Get('imaging-requests')
  @ApiOperation({ summary: 'List imaging requests by encounter or patient.' })
  @ApiQuery({ name: 'encounterId', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  listRequests(
    @Query('encounterId') encounterId?: string,
    @Query('patientId') patientId?: string,
  ): Promise<ImagingRequestDto[]> {
    if (encounterId) return this.requests.listForEncounter(encounterId);
    if (patientId) return this.requests.listForPatient(patientId);
    return Promise.resolve([]);
  }

  @RequirePermission('imaging_request', 'read')
  @Get('imaging-requests/:id')
  @ApiOperation({ summary: 'Get one imaging request by id.' })
  findRequest(@Param('id') id: string): Promise<ImagingRequestDto> {
    return this.requests.findById(id);
  }

  @RequirePermission('imaging_request', 'update')
  @Patch('imaging-requests/:id/status')
  @ApiOperation({
    summary:
      'Transition an imaging request status. REPORTED is set automatically when a report finalizes.',
  })
  updateRequestStatus(
    @Param('id') id: string,
    @Body() dto: UpdateImagingRequestStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingRequestDto> {
    return this.requests.updateStatus(id, dto, user.userId);
  }

  // --- Studies -------------------------------------------------------------

  @RequirePermission('imaging_study', 'create')
  @Post('imaging-requests/:requestId/studies')
  @ApiOperation({
    summary: 'Record performance of an imaging study; flips the parent request to PERFORMED.',
  })
  recordStudy(
    @Param('requestId') requestId: string,
    @Body() dto: CreateImagingStudyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingStudyDto> {
    return this.studies.record(requestId, dto, user.userId);
  }

  @RequirePermission('imaging_study', 'read')
  @Get('imaging-requests/:requestId/studies')
  @ApiOperation({ summary: 'List studies for an imaging request.' })
  listStudies(@Param('requestId') requestId: string): Promise<ImagingStudyDto[]> {
    return this.studies.listForRequest(requestId);
  }

  @RequirePermission('imaging_study', 'read')
  @Get('imaging-studies/:id')
  @ApiOperation({ summary: 'Get one imaging study by id.' })
  findStudy(@Param('id') id: string): Promise<ImagingStudyDto> {
    return this.studies.findById(id);
  }

  // --- Reports -------------------------------------------------------------

  @RequirePermission('imaging_report', 'create')
  @Post('imaging-studies/:studyId/report')
  @ApiOperation({ summary: 'Create the radiologist report for a study (one per study).' })
  createReport(
    @Param('studyId') studyId: string,
    @Body() dto: CreateImagingReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingReportDto> {
    return this.reports.create(studyId, dto, user.userId);
  }

  @RequirePermission('imaging_report', 'read')
  @Get('imaging-studies/:studyId/report')
  @ApiOperation({ summary: 'Get the report for a study (null if none yet).' })
  getReportForStudy(@Param('studyId') studyId: string): Promise<ImagingReportDto | null> {
    return this.reports.findForStudy(studyId);
  }

  @RequirePermission('imaging_report', 'read')
  @Get('imaging-reports/:id')
  @ApiOperation({ summary: 'Get one imaging report by id.' })
  findReport(@Param('id') id: string): Promise<ImagingReportDto> {
    return this.reports.findById(id);
  }

  @RequirePermission('imaging_report', 'update')
  @Patch('imaging-reports/:id')
  @ApiOperation({ summary: 'Edit a non-finalized report.' })
  editReport(
    @Param('id') id: string,
    @Body() dto: UpdateImagingReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingReportDto> {
    return this.reports.updateContents(id, dto, user.userId);
  }

  @RequirePermission('imaging_report', 'update')
  @Patch('imaging-reports/:id/status')
  @ApiOperation({
    summary: 'Advance the report state machine. FINALIZED flips the parent request to REPORTED.',
  })
  updateReportStatus(
    @Param('id') id: string,
    @Body() dto: UpdateImagingReportStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImagingReportDto> {
    return this.reports.updateStatus(id, dto, user.userId);
  }
}
