import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import type { MedicineRoute, PrescriptionStatus } from './prescription.dto';

const ROUTES: MedicineRoute[] = [
  'ORAL',
  'IV',
  'IM',
  'SC',
  'TOPICAL',
  'INHALED',
  'OPHTHALMIC',
  'OTIC',
  'NASAL',
  'RECTAL',
  'OTHER',
];

export class CreatePrescriptionItemDto {
  @ApiProperty() @IsString() medicineId!: string;

  @ApiProperty({ example: '1 tablet' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  dose!: string;

  @ApiProperty({ enum: ROUTES })
  @IsIn(ROUTES)
  route!: MedicineRoute;

  @ApiProperty({ example: 'BID' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  frequency!: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  durationDays?: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantityToDispense!: number;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  prn?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prnReason?: string;

  @ApiProperty({
    required: false,
    description: 'Patient-facing instructions (PHI, encrypted at rest).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  instructions?: string;
}

export class CreatePrescriptionDto {
  @ApiProperty() @IsString() encounterId!: string;

  @ApiProperty({
    description: 'Prescriber user id. If omitted, the authenticated user is used.',
    required: false,
  })
  @IsOptional()
  @IsString()
  prescriberUserId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  notes?: string;

  @ApiProperty({ type: () => CreatePrescriptionItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items!: CreatePrescriptionItemDto[];
}

export class UpdatePrescriptionStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED'] })
  @IsIn(['ACTIVE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED'])
  status!: PrescriptionStatus;

  @ApiProperty({ required: false, description: 'Required when transitioning to CANCELLED.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelledReason?: string;
}
