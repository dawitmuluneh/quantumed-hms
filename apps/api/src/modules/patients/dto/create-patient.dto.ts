import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import type { DependentRelation, PatientSex } from './patient.dto';

export class CreatePatientDto {
  @ApiProperty({ description: 'Optional client-supplied MRN. Server generates one if omitted.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{4,32}$/)
  mrn?: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @ApiProperty({ example: '1990-01-15' }) @IsDateString() dob!: string;
  @ApiProperty({ enum: ['M', 'F', 'O', 'U'] }) @IsIn(['M', 'F', 'O', 'U']) sex!: PatientSex;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiProperty({
    required: false,
    description: 'Free-form postal address (single line or multi-line).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiProperty({ required: false, default: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  preferredLanguage?: string;

  @ApiProperty({
    required: false,
    description: 'Optional CUID of platform.users.id if the patient self-registers.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  portalUserId?: string;
}

export class UpdatePatientDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() dob?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsIn(['M', 'F', 'O', 'U']) sex?: PatientSex;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  preferredLanguage?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'DECEASED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'DECEASED';
}

export class CreateDependentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @ApiProperty() @IsDateString() dob!: string;
  @ApiProperty({ enum: ['CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER'] })
  @IsIn(['CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER'])
  relation!: DependentRelation;

  @ApiProperty({
    required: false,
    description: 'Optional pointer to an existing patient row if the dependent has their own MRN.',
  })
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class ListPatientsQueryDto {
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  pageSize?: number;

  @ApiProperty({ required: false, description: 'Opaque cursor returned by previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiProperty({ required: false, enum: ['ACTIVE', 'INACTIVE', 'DECEASED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'DECEASED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'DECEASED';

  @ApiProperty({ required: false, description: 'Substring match against MRN (case-insensitive).' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  mrn?: string;
}
