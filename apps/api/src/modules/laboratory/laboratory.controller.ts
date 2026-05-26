import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';

import {
  CreateLabOrderDto,
  CreateLabResultDto,
  CreateLabTestDto,
  UpdateLabOrderStatusDto,
  UpdateLabTestDto,
  VerifyLabResultDto,
} from './dto/create-lab.dto';
import { LabOrderDto, LabResultDto, LabTestDto } from './dto/lab.dto';
import { LabOrdersService } from './lab-orders.service';
import { LabResultsService } from './lab-results.service';
import { LabTestsService } from './lab-tests.service';

@ApiBearerAuth('bearer')
@ApiTags('laboratory')
@Controller()
export class LaboratoryController {
  constructor(
    private readonly tests: LabTestsService,
    private readonly orders: LabOrdersService,
    private readonly results: LabResultsService,
  ) {}

  // --- Catalog -------------------------------------------------------------

  @RequirePermission('lab_test', 'create')
  @Post('lab-tests')
  @ApiOperation({ summary: 'Create a new lab test in the catalog.' })
  createTest(
    @Body() dto: CreateLabTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabTestDto> {
    return this.tests.create(dto, user.userId);
  }

  @RequirePermission('lab_test', 'update')
  @Patch('lab-tests/:id')
  @ApiOperation({ summary: 'Update a lab test in the catalog.' })
  updateTest(
    @Param('id') id: string,
    @Body() dto: UpdateLabTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabTestDto> {
    return this.tests.update(id, dto, user.userId);
  }

  @RequirePermission('lab_test', 'read')
  @Get('lab-tests/:id')
  @ApiOperation({ summary: 'Get a single lab test by id.' })
  findTest(@Param('id') id: string): Promise<LabTestDto> {
    return this.tests.findById(id);
  }

  @RequirePermission('lab_test', 'read')
  @Get('lab-tests')
  @ApiOperation({ summary: 'List lab tests (catalog).' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  listTests(@Query('activeOnly') activeOnly?: string): Promise<LabTestDto[]> {
    return this.tests.list({ activeOnly: activeOnly === 'true' });
  }

  // --- Orders --------------------------------------------------------------

  @RequirePermission('lab_order', 'create')
  @Post('lab-orders')
  @ApiOperation({ summary: 'Create a lab order with one or more requested tests.' })
  createOrder(
    @Body() dto: CreateLabOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabOrderDto> {
    return this.orders.create(dto, user.userId);
  }

  @RequirePermission('lab_order', 'read')
  @Get('lab-orders')
  @ApiOperation({
    summary: 'List lab orders filtered by encounter or patient (newest first).',
  })
  @ApiQuery({ name: 'encounterId', required: false })
  @ApiQuery({ name: 'patientId', required: false })
  listOrders(
    @Query('encounterId') encounterId?: string,
    @Query('patientId') patientId?: string,
  ): Promise<LabOrderDto[]> {
    if (encounterId) return this.orders.listForEncounter(encounterId);
    if (patientId) return this.orders.listForPatient(patientId);
    return Promise.resolve([]);
  }

  @RequirePermission('lab_order', 'read')
  @Get('lab-orders/:id')
  @ApiOperation({ summary: 'Get one lab order by id (with items and latest result per item).' })
  findOrder(@Param('id') id: string): Promise<LabOrderDto> {
    return this.orders.findById(id);
  }

  @RequirePermission('lab_order', 'update')
  @Patch('lab-orders/:id/status')
  @ApiOperation({ summary: 'Transition a lab order status (collect, start, complete, cancel).' })
  updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLabOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabOrderDto> {
    return this.orders.updateStatus(id, dto, user.userId);
  }

  // --- Results -------------------------------------------------------------

  @RequirePermission('lab_result', 'create')
  @Post('lab-order-items/:itemId/results')
  @ApiOperation({
    summary: 'Enter a result against a lab order item; flag is auto-computed for numeric values.',
  })
  enterResult(
    @Param('itemId') itemId: string,
    @Body() dto: CreateLabResultDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabResultDto> {
    return this.results.enter(itemId, dto, user.userId);
  }

  @RequirePermission('lab_result', 'read')
  @Get('lab-order-items/:itemId/results')
  @ApiOperation({ summary: 'List historical results for an item (newest first).' })
  listItemResults(@Param('itemId') itemId: string): Promise<LabResultDto[]> {
    return this.results.listForItem(itemId);
  }

  @RequirePermission('lab_result', 'read')
  @Get('lab-results/:id')
  @ApiOperation({ summary: 'Get a single lab result by id.' })
  findResult(@Param('id') id: string): Promise<LabResultDto> {
    return this.results.findById(id);
  }

  @RequirePermission('lab_result', 'update')
  @Patch('lab-results/:id/verify')
  @ApiOperation({
    summary: 'Verify a lab result (verifier must differ from the entering technician).',
  })
  verifyResult(
    @Param('id') id: string,
    @Body() dto: VerifyLabResultDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LabResultDto> {
    return this.results.verify(id, dto, user.userId);
  }
}
