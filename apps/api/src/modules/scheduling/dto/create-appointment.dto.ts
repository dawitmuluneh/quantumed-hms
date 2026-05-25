import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { AppointmentStatus, ResourceType } from './scheduling.dto';

const TIME_HHMMSS = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CreateAppointmentDto {
  @ApiProperty() @IsString() patientId!: string;
  @ApiProperty() @IsString() providerUserId!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() resourceId?: string;

  @ApiProperty({ example: '2025-06-01T09:00:00Z' }) @IsDateString() scheduledStart!: string;
  @ApiProperty({ example: '2025-06-01T09:30:00Z' }) @IsDateString() scheduledEnd!: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @ApiProperty({ required: false, description: 'PHI notes — encrypted at rest.' })
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  notes?: string;
}

export class UpdateAppointmentStatusDto {
  @ApiProperty({
    enum: [
      'SCHEDULED',
      'CONFIRMED',
      'CHECKED_IN',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'NO_SHOW',
    ],
  })
  @IsIn([
    'SCHEDULED',
    'CONFIRMED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ])
  status!: AppointmentStatus;

  @ApiProperty({ required: false, description: 'Required when transitioning to CANCELLED.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelledReason?: string;
}

export class ListAppointmentsQueryDto {
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() from?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() to?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() providerUserId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() patientId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn([
    'SCHEDULED',
    'CONFIRMED',
    'CHECKED_IN',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
  ])
  status?: AppointmentStatus;
}

export class CreateScheduleDto {
  @ApiProperty() @IsString() providerUserId!: string;
  @ApiProperty({ minimum: 0, maximum: 6 }) @IsInt() @Min(0) @Max(6) dayOfWeek!: number;
  @ApiProperty({ example: '09:00:00' }) @IsString() @Matches(TIME_HHMMSS) startTime!: string;
  @ApiProperty({ example: '17:00:00' }) @IsString() @Matches(TIME_HHMMSS) endTime!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() effectiveFrom?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() effectiveUntil?: string;
  @ApiProperty({ required: false, default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateResourceDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['ROOM', 'BED', 'EQUIPMENT'] })
  @IsIn(['ROOM', 'BED', 'EQUIPMENT'])
  resourceType!: ResourceType;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(160) location?: string;
  @ApiProperty({ required: false, default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}
