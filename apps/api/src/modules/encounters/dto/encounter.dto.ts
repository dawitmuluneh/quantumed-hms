import { ApiProperty } from '@nestjs/swagger';

export type EncounterType = 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'TELEMEDICINE';
export type EncounterStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export class EncounterDto {
  @ApiProperty() id!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() providerUserId!: string;
  @ApiProperty({ nullable: true, required: false }) appointmentId?: string | null;
  @ApiProperty({ enum: ['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'TELEMEDICINE'] })
  encounterType!: EncounterType;
  @ApiProperty({ nullable: true, required: false }) chiefComplaint?: string | null;
  @ApiProperty({ nullable: true, required: false, description: 'Decrypted progress notes (PHI).' })
  notes?: string | null;
  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'CANCELLED'] }) status!: EncounterStatus;
  @ApiProperty() startedAt!: string;
  @ApiProperty({ nullable: true, required: false }) endedAt?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class VitalsDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() recordedAt!: string;
  @ApiProperty({ nullable: true, required: false }) heartRateBpm?: number | null;
  @ApiProperty({ nullable: true, required: false }) systolicBp?: number | null;
  @ApiProperty({ nullable: true, required: false }) diastolicBp?: number | null;
  @ApiProperty({ nullable: true, required: false }) spo2Pct?: number | null;
  @ApiProperty({ nullable: true, required: false }) temperatureC?: number | null;
  @ApiProperty({ nullable: true, required: false }) respiratoryRate?: number | null;
  @ApiProperty({ nullable: true, required: false }) weightKg?: number | null;
  @ApiProperty({ nullable: true, required: false }) heightCm?: number | null;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Computed from weight/height at insert.',
  })
  bmi?: number | null;
  @ApiProperty({ nullable: true, required: false }) painScore?: number | null;
  @ApiProperty({ nullable: true, required: false }) notes?: string | null;
  @ApiProperty() recordedByUserId!: string;
  @ApiProperty() createdAt!: string;
}

export class EncounterDiagnosisDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty({ example: 'J45.909' }) icd10Code!: string;
  @ApiProperty({ example: 'Unspecified asthma, uncomplicated' }) icd10Description!: string;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty() createdAt!: string;
}
