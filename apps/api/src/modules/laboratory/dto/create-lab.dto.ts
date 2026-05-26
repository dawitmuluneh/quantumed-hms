import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type {
  LabOrderItemStatus,
  LabOrderPriority,
  LabOrderStatus,
  LabResultFlag,
  SpecimenType,
} from './lab.dto';

const SPECIMENS: SpecimenType[] = [
  'BLOOD',
  'SERUM',
  'PLASMA',
  'URINE',
  'STOOL',
  'SPUTUM',
  'CSF',
  'SWAB',
  'TISSUE',
  'OTHER',
];

const PRIORITIES: LabOrderPriority[] = ['ROUTINE', 'URGENT', 'STAT', 'EMERGENCY'];

const ORDER_STATUSES: LabOrderStatus[] = [
  'PENDING_COLLECTION',
  'COLLECTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
];

const ITEM_STATUSES: LabOrderItemStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'RESULTED',
  'VERIFIED',
  'CANCELLED',
];

const RESULT_FLAGS: LabResultFlag[] = [
  'NORMAL',
  'LOW',
  'HIGH',
  'CRITICAL_LOW',
  'CRITICAL_HIGH',
  'ABNORMAL',
];

export class CreateLabTestDto {
  @ApiProperty({ example: 'CBC' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'code must be uppercase alphanumeric / underscore / hyphen',
  })
  code!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name!: string;

  @ApiProperty({ enum: SPECIMENS })
  @IsIn(SPECIMENS)
  specimenType!: SpecimenType;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) unit?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsNumber() referenceLow?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() referenceHigh?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() criticalLow?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() criticalHigh?: number;

  @ApiProperty({ required: false, minimum: 1, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  turnaroundMinutes?: number;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLabTestDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) name?: string;

  @ApiProperty({ required: false, enum: SPECIMENS })
  @IsOptional()
  @IsIn(SPECIMENS)
  specimenType?: SpecimenType;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) unit?: string | null;

  @ApiProperty({ required: false }) @IsOptional() @IsNumber() referenceLow?: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() referenceHigh?: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() criticalLow?: number | null;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() criticalHigh?: number | null;

  @ApiProperty({ required: false, minimum: 1, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  turnaroundMinutes?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateLabOrderItemDto {
  @ApiProperty() @IsString() labTestId!: string;

  @ApiProperty({
    required: false,
    description: 'Per-test prep / collection instructions (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  instructions?: string;
}

export class CreateLabOrderDto {
  @ApiProperty() @IsString() encounterId!: string;

  @ApiProperty({
    description: 'Ordering clinician. If omitted, the authenticated user is used.',
    required: false,
  })
  @IsOptional()
  @IsString()
  orderedByUserId?: string;

  @ApiProperty({ enum: PRIORITIES, required: false, default: 'ROUTINE' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: LabOrderPriority;

  @ApiProperty({ description: 'Lab sample barcode; must be globally unique per tenant.' })
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  sampleBarcode!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  @ApiProperty({ type: () => CreateLabOrderItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateLabOrderItemDto)
  items!: CreateLabOrderItemDto[];
}

export class UpdateLabOrderStatusDto {
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  status!: LabOrderStatus;

  @ApiProperty({ required: false, description: 'Required when transitioning to CANCELLED.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelledReason?: string;
}

export class UpdateLabOrderItemStatusDto {
  @ApiProperty({ enum: ITEM_STATUSES })
  @IsIn(ITEM_STATUSES)
  status!: LabOrderItemStatus;
}

export class CreateLabResultDto {
  @ApiProperty({
    required: false,
    description: 'Numeric value; one of valueNumeric / valueText must be set.',
  })
  @IsOptional()
  @IsNumber()
  valueNumeric?: number;

  @ApiProperty({
    required: false,
    description: 'Free-text value (e.g. "POS"); one of valueNumeric / valueText must be set.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  valueText?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) unit?: string;

  @ApiProperty({
    required: false,
    enum: RESULT_FLAGS,
    description: 'Optional explicit flag for text-only results; numeric results auto-flag.',
  })
  @IsOptional()
  @IsIn(RESULT_FLAGS)
  flag?: LabResultFlag;

  @ApiProperty({
    required: false,
    description: 'Result notes (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  notes?: string;
}

export class VerifyLabResultDto {
  @ApiProperty({ required: false, description: 'Optional verifier override.' })
  @IsOptional()
  @IsString()
  verifiedByUserId?: string;
}
