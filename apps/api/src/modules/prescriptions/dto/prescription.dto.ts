import { ApiProperty } from '@nestjs/swagger';

export type PrescriptionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'SUPERSEDED';

export type MedicineRoute =
  | 'ORAL'
  | 'IV'
  | 'IM'
  | 'SC'
  | 'TOPICAL'
  | 'INHALED'
  | 'OPHTHALMIC'
  | 'OTIC'
  | 'NASAL'
  | 'RECTAL'
  | 'OTHER';

export class PrescriptionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() prescriptionId!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty({ example: '1 tablet' }) dose!: string;
  @ApiProperty({
    enum: [
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
    ],
  })
  route!: MedicineRoute;
  @ApiProperty({ example: 'BID' }) frequency!: string;
  @ApiProperty({ nullable: true, required: false }) durationDays?: number | null;
  @ApiProperty() quantityToDispense!: number;
  @ApiProperty() prn!: boolean;
  @ApiProperty({ nullable: true, required: false }) prnReason?: string | null;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted patient-facing instructions (PHI).',
  })
  instructions?: string | null;
  @ApiProperty() createdAt!: string;
}

export class PrescriptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() prescriberUserId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED'] })
  status!: PrescriptionStatus;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted free-text notes from the prescriber (PHI).',
  })
  notes?: string | null;
  @ApiProperty({ nullable: true, required: false }) cancelledReason?: string | null;
  @ApiProperty() issuedAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: () => PrescriptionItemDto, isArray: true })
  items!: PrescriptionItemDto[];
}
