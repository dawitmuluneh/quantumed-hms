import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { MedicineForm } from './pharmacy.dto';

const MEDICINE_FORMS: MedicineForm[] = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'INJECTION',
  'CREAM',
  'DROPS',
  'INHALER',
  'PATCH',
  'OTHER',
];

export class CreateMedicineDto {
  @ApiProperty({ example: 'AMOX-500' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  // Anchored, bounded — no nested quantifiers (linter heuristic is overly cautious).
  // eslint-disable-next-line security/detect-unsafe-regex
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,62}[A-Z0-9]$/, {
    message: 'code must be uppercase alphanumeric with dashes/underscores',
  })
  code!: string;

  @ApiProperty({ example: 'Amoxicillin' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  genericName!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandName?: string;

  @ApiProperty({ enum: MEDICINE_FORMS })
  @IsIn(MEDICINE_FORMS)
  form!: MedicineForm;

  @ApiProperty({ required: false, example: '500 mg' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  strength?: string;

  @ApiProperty({ required: false, example: 'J01CA04' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  atcCode?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isControlled?: boolean;

  @ApiProperty({ required: false, default: 'unit' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  defaultUnit?: string;
}

export class UpdateMedicineDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  strength?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  atcCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isControlled?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReceiveBatchDto {
  @ApiProperty() @IsString() medicineId!: string;

  @ApiProperty({ example: 'LOT-2025-001' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  lotNumber!: string;

  @ApiProperty({ description: 'ISO date (YYYY-MM-DD).' })
  @IsDateString()
  expiresOn!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ required: false, description: 'Defaults to the medicine.defaultUnit.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;
}

export class CreateDispenseDto {
  @ApiProperty() @IsString() prescriptionItemId!: string;

  @ApiProperty({
    required: false,
    description:
      'Specific batch to dispense from. If omitted, the service picks the first-expiring batch with stock.',
  })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
