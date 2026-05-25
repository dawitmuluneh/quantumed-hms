import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
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
} from 'class-validator';

import type { EncounterStatus, EncounterType } from './encounter.dto';

export class CreateEncounterDto {
  @ApiProperty() @IsString() patientId!: string;

  @ApiProperty({
    description:
      'Provider taking the encounter. If omitted, the authenticated user is used (when they hold the doctor role).',
    required: false,
  })
  @IsOptional()
  @IsString()
  providerUserId?: string;

  @ApiProperty({ enum: ['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'TELEMEDICINE'] })
  @IsIn(['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'TELEMEDICINE'])
  encounterType!: EncounterType;

  @ApiProperty({
    required: false,
    description: 'Linked appointment if checking in from a booking.',
  })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  chiefComplaint?: string;
  @ApiProperty({ required: false, description: 'Initial progress notes (PHI, encrypted at rest).' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;
}

export class UpdateEncounterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  chiefComplaint?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(20_000) notes?: string;
  @ApiProperty({ required: false, enum: ['OPEN', 'CLOSED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED', 'CANCELLED'])
  status?: EncounterStatus;
  @ApiProperty({ required: false, description: 'Provided when status flips to CLOSED.' })
  @IsOptional()
  @IsDateString()
  endedAt?: string;
}

export class RecordVitalsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) @Max(300) heartRateBpm?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(40) @Max(300) systolicBp?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(20) @Max(200) diastolicBp?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(100) spo2Pct?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(45)
  temperatureC?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(80)
  respiratoryRate?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0.5) @Max(500) weightKg?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(20) @Max(260) heightCm?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsInt() @Min(0) @Max(10) painScore?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(2_000) notes?: string;
}

export class AddDiagnosisDto {
  @ApiProperty({ example: 'J45.909' })
  @IsString()
  @MinLength(3)
  @MaxLength(10)
  // Anchored, bounded ({2}, {1,4}), single optional group — no catastrophic
  // backtracking; the linter heuristic flags any nested quantifier shape.
  // eslint-disable-next-line security/detect-unsafe-regex
  @Matches(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/, {
    message: 'icd10Code must follow the ICD-10-CM format, e.g. J45.909',
  })
  icd10Code!: string;

  @ApiProperty({ example: 'Unspecified asthma, uncomplicated' })
  @IsString()
  @MinLength(3)
  @MaxLength(250)
  icd10Description!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
