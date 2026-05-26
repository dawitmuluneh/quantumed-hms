import { ApiProperty } from '@nestjs/swagger';

export type SpecimenType =
  | 'BLOOD'
  | 'SERUM'
  | 'PLASMA'
  | 'URINE'
  | 'STOOL'
  | 'SPUTUM'
  | 'CSF'
  | 'SWAB'
  | 'TISSUE'
  | 'OTHER';

export type LabOrderPriority = 'ROUTINE' | 'URGENT' | 'STAT' | 'EMERGENCY';

export type LabOrderStatus =
  | 'PENDING_COLLECTION'
  | 'COLLECTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type LabOrderItemStatus = 'PENDING' | 'IN_PROGRESS' | 'RESULTED' | 'VERIFIED' | 'CANCELLED';

export type LabResultFlag =
  | 'NORMAL'
  | 'LOW'
  | 'HIGH'
  | 'CRITICAL_LOW'
  | 'CRITICAL_HIGH'
  | 'ABNORMAL';

export class LabTestDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    enum: [
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
    ],
  })
  specimenType!: SpecimenType;
  @ApiProperty({ nullable: true, required: false }) unit?: string | null;
  @ApiProperty({ nullable: true, required: false }) referenceLow?: number | null;
  @ApiProperty({ nullable: true, required: false }) referenceHigh?: number | null;
  @ApiProperty({ nullable: true, required: false }) criticalLow?: number | null;
  @ApiProperty({ nullable: true, required: false }) criticalHigh?: number | null;
  @ApiProperty({ nullable: true, required: false }) turnaroundMinutes?: number | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class LabResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() labOrderItemId!: string;
  @ApiProperty({ nullable: true, required: false }) valueNumeric?: number | null;
  @ApiProperty({ nullable: true, required: false }) valueText?: string | null;
  @ApiProperty({ nullable: true, required: false }) unit?: string | null;
  @ApiProperty({
    enum: ['NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL'],
  })
  flag!: LabResultFlag;
  @ApiProperty({ nullable: true, required: false }) referenceLow?: number | null;
  @ApiProperty({ nullable: true, required: false }) referenceHigh?: number | null;
  @ApiProperty({ nullable: true, required: false }) criticalLow?: number | null;
  @ApiProperty({ nullable: true, required: false }) criticalHigh?: number | null;
  @ApiProperty() observedAt!: string;
  @ApiProperty() enteredByUserId!: string;
  @ApiProperty({ nullable: true, required: false }) verifiedByUserId?: string | null;
  @ApiProperty({ nullable: true, required: false }) verifiedAt?: string | null;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted result notes (PHI).',
  })
  notes?: string | null;
  @ApiProperty() createdAt!: string;
}

export class LabOrderItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() labOrderId!: string;
  @ApiProperty() labTestId!: string;
  @ApiProperty({
    enum: ['PENDING', 'IN_PROGRESS', 'RESULTED', 'VERIFIED', 'CANCELLED'],
  })
  status!: LabOrderItemStatus;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted per-test instructions (PHI).',
  })
  instructions?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: () => LabResultDto, nullable: true, required: false })
  latestResult?: LabResultDto | null;
}

export class LabOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() orderedByUserId!: string;
  @ApiProperty({ enum: ['ROUTINE', 'URGENT', 'STAT', 'EMERGENCY'] })
  priority!: LabOrderPriority;
  @ApiProperty({
    enum: ['PENDING_COLLECTION', 'COLLECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  status!: LabOrderStatus;
  @ApiProperty() sampleBarcode!: string;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted free-text notes (PHI).',
  })
  notes?: string | null;
  @ApiProperty() orderedAt!: string;
  @ApiProperty({ nullable: true, required: false }) collectedAt?: string | null;
  @ApiProperty({ nullable: true, required: false }) completedAt?: string | null;
  @ApiProperty({ nullable: true, required: false }) cancelledReason?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: () => LabOrderItemDto, isArray: true })
  items!: LabOrderItemDto[];
}
