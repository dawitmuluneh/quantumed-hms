import { ApiProperty } from '@nestjs/swagger';
import { HospitalTier, IsolationMode } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateHospitalDto {
  @ApiProperty({ example: 'Demo Hospital' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'demo' })
  @IsString()
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded quantifier {0,46} makes this safe.
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/, {
    message: 'slug must be lowercase alphanumeric with optional hyphens, max 48 chars',
  })
  slug!: string;

  @ApiProperty({ enum: HospitalTier, default: HospitalTier.STANDARD })
  @IsOptional()
  @IsEnum(HospitalTier)
  tier?: HospitalTier;

  @ApiProperty({ enum: IsolationMode, default: IsolationMode.SCHEMA })
  @IsOptional()
  @IsEnum(IsolationMode)
  isolationMode?: IsolationMode;

  @ApiProperty({ example: 'en' })
  @IsOptional()
  @IsString()
  defaultLocale?: string;

  @ApiProperty({ example: 'UTC' })
  @IsOptional()
  @IsString()
  defaultTimezone?: string;

  @ApiProperty({ example: 'USD' })
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  @ApiProperty({
    description: 'Initial Hospital Admin email; receives temp password',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  adminEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  adminFullName?: string;
}
