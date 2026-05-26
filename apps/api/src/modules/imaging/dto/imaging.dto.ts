import { ApiProperty } from '@nestjs/swagger';

export type ImagingModality = 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND' | 'MAMMOGRAPHY' | 'FLUOROSCOPY';

export type ImagingPriority = 'ROUTINE' | 'URGENT' | 'STAT' | 'EMERGENCY';

export type ImagingRequestStatus =
  | 'REQUESTED'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'PERFORMED'
  | 'REPORTED'
  | 'CANCELLED';

export type ImagingReportStatus = 'DRAFT' | 'PENDING_REVIEW' | 'REVIEWED' | 'FINALIZED';

export class ImagingRequestDto {
  @ApiProperty() id!: string;
  @ApiProperty() encounterId!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() orderedByUserId!: string;
  @ApiProperty({
    enum: ['XRAY', 'CT', 'MRI', 'ULTRASOUND', 'MAMMOGRAPHY', 'FLUOROSCOPY'],
  })
  modality!: ImagingModality;
  @ApiProperty() bodyPart!: string;
  @ApiProperty({ enum: ['ROUTINE', 'URGENT', 'STAT', 'EMERGENCY'] })
  priority!: ImagingPriority;
  @ApiProperty({
    enum: ['REQUESTED', 'SCHEDULED', 'IN_PROGRESS', 'PERFORMED', 'REPORTED', 'CANCELLED'],
  })
  status!: ImagingRequestStatus;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted clinical question / reason for study (PHI).',
  })
  clinicalQuestion?: string | null;
  @ApiProperty() orderedAt!: string;
  @ApiProperty({ nullable: true, required: false }) scheduledFor?: string | null;
  @ApiProperty({ nullable: true, required: false }) cancelledReason?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ImagingStudyDto {
  @ApiProperty() id!: string;
  @ApiProperty() imagingRequestId!: string;
  @ApiProperty({ nullable: true, required: false }) equipmentId?: string | null;
  @ApiProperty() performedByUserId!: string;
  @ApiProperty() performedAt!: string;
  @ApiProperty({ nullable: true, required: false }) protocol?: string | null;
  @ApiProperty() imageCount!: number;
  @ApiProperty({ type: [String] }) dicomObjectKeys!: string[];
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted technologist notes (PHI).',
  })
  notes?: string | null;
  @ApiProperty() createdAt!: string;
}

export class ImagingReportDto {
  @ApiProperty() id!: string;
  @ApiProperty() imagingStudyId!: string;
  @ApiProperty() radiologistUserId!: string;
  @ApiProperty({ enum: ['DRAFT', 'PENDING_REVIEW', 'REVIEWED', 'FINALIZED'] })
  status!: ImagingReportStatus;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted findings (PHI).',
  })
  findings?: string | null;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted impression (PHI).',
  })
  impression?: string | null;
  @ApiProperty({
    nullable: true,
    required: false,
    description: 'Decrypted recommendations (PHI).',
  })
  recommendations?: string | null;
  @ApiProperty({ nullable: true, required: false }) reviewerUserId?: string | null;
  @ApiProperty({ nullable: true, required: false }) signedAt?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
