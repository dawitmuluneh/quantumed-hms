import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type {
  ImagingModality,
  ImagingPriority,
  ImagingReportStatus,
  ImagingRequestStatus,
} from './imaging.dto';

const MODALITIES: ImagingModality[] = [
  'XRAY',
  'CT',
  'MRI',
  'ULTRASOUND',
  'MAMMOGRAPHY',
  'FLUOROSCOPY',
];

const PRIORITIES: ImagingPriority[] = ['ROUTINE', 'URGENT', 'STAT', 'EMERGENCY'];

const REQUEST_STATUSES: ImagingRequestStatus[] = [
  'REQUESTED',
  'SCHEDULED',
  'IN_PROGRESS',
  'PERFORMED',
  'REPORTED',
  'CANCELLED',
];

const REPORT_STATUSES: ImagingReportStatus[] = ['DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'FINALIZED'];

export class CreateImagingRequestDto {
  @ApiProperty() @IsString() encounterId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderedByUserId?: string;

  @ApiProperty({ enum: MODALITIES })
  @IsIn(MODALITIES)
  modality!: ImagingModality;

  @ApiProperty({ example: 'Chest PA' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bodyPart!: string;

  @ApiProperty({ enum: PRIORITIES, required: false, default: 'ROUTINE' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: ImagingPriority;

  @ApiProperty({
    required: false,
    description: 'Clinical question / reason for study (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  clinicalQuestion?: string;

  @ApiProperty({ required: false, description: 'Optional scheduled performance time (ISO 8601).' })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class UpdateImagingRequestStatusDto {
  @ApiProperty({ enum: REQUEST_STATUSES })
  @IsIn(REQUEST_STATUSES)
  status!: ImagingRequestStatus;

  @ApiProperty({ required: false, description: 'Required when transitioning to CANCELLED.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelledReason?: string;

  @ApiProperty({
    required: false,
    description: 'Required when transitioning to SCHEDULED (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class CreateImagingStudyDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) equipmentId?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() performedByUserId?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(200) protocol?: string;

  @ApiProperty({ minimum: 0, default: 0 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  imageCount!: number;

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10_000)
  @IsString({ each: true })
  dicomObjectKeys?: string[];

  @ApiProperty({
    required: false,
    description: 'Technologist notes (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  notes?: string;
}

export class CreateImagingReportDto {
  @ApiProperty({ required: false, description: 'Radiologist override; defaults to caller.' })
  @IsOptional()
  @IsString()
  radiologistUserId?: string;

  @ApiProperty({
    required: false,
    description: 'Findings (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  findings?: string;

  @ApiProperty({
    required: false,
    description: 'Impression (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  impression?: string;

  @ApiProperty({
    required: false,
    description: 'Recommendations (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  recommendations?: string;
}

export class UpdateImagingReportDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20_000) findings?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  impression?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  recommendations?: string;
}

export class UpdateImagingReportStatusDto {
  @ApiProperty({ enum: REPORT_STATUSES })
  @IsIn(REPORT_STATUSES)
  status!: ImagingReportStatus;

  @ApiProperty({ required: false, description: 'Reviewer for REVIEWED transition.' })
  @IsOptional()
  @IsString()
  reviewerUserId?: string;
}
