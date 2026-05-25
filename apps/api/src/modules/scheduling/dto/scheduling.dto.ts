import { ApiProperty } from '@nestjs/swagger';

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type ResourceType = 'ROOM' | 'BED' | 'EQUIPMENT';

export class AppointmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() patientId!: string;
  @ApiProperty() providerUserId!: string;
  @ApiProperty({ nullable: true, required: false }) resourceId?: string | null;
  @ApiProperty() scheduledStart!: string;
  @ApiProperty() scheduledEnd!: string;
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
  status!: AppointmentStatus;
  @ApiProperty({ nullable: true, required: false }) reason?: string | null;
  @ApiProperty({ nullable: true, required: false }) notes?: string | null;
  @ApiProperty({ nullable: true, required: false }) encounterId?: string | null;
  @ApiProperty({ nullable: true, required: false }) createdByUserId?: string | null;
  @ApiProperty({ nullable: true, required: false }) cancelledReason?: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ScheduleDto {
  @ApiProperty() id!: string;
  @ApiProperty() providerUserId!: string;
  @ApiProperty({ description: '0=Sunday, 6=Saturday' }) dayOfWeek!: number;
  @ApiProperty({ example: '09:00:00' }) startTime!: string;
  @ApiProperty({ example: '17:00:00' }) endTime!: string;
  @ApiProperty({ nullable: true, required: false }) effectiveFrom?: string | null;
  @ApiProperty({ nullable: true, required: false }) effectiveUntil?: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ResourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ROOM', 'BED', 'EQUIPMENT'] }) resourceType!: ResourceType;
  @ApiProperty({ nullable: true, required: false }) location?: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
