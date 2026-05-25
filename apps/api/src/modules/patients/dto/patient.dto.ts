import { ApiProperty } from '@nestjs/swagger';

export type PatientSex = 'M' | 'F' | 'O' | 'U';
export type PatientStatus = 'ACTIVE' | 'INACTIVE' | 'DECEASED';
export type DependentRelation = 'CHILD' | 'SPOUSE' | 'PARENT' | 'SIBLING' | 'OTHER';

/**
 * Decrypted view of a patient row. PHI is decrypted in-process by the
 * service before crossing the controller boundary; only authorized roles
 * reach this point (RBAC matrix enforced upstream).
 */
export class PatientDto {
  @ApiProperty() id!: string;
  @ApiProperty() mrn!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ description: 'ISO-8601 date of birth (YYYY-MM-DD).' }) dob!: string;
  @ApiProperty({ enum: ['M', 'F', 'O', 'U'] }) sex!: PatientSex;
  @ApiProperty({ nullable: true, required: false }) phone?: string | null;
  @ApiProperty({ nullable: true, required: false }) email?: string | null;
  @ApiProperty({ nullable: true, required: false }) address?: string | null;
  @ApiProperty() preferredLanguage!: string;
  @ApiProperty({ nullable: true, required: false }) portalUserId?: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'DECEASED'] }) status!: PatientStatus;
  @ApiProperty() registeredAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class DependentDto {
  @ApiProperty() id!: string;
  @ApiProperty() guardianPatientId!: string;
  @ApiProperty({ nullable: true, required: false }) patientId?: string | null;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() dob!: string;
  @ApiProperty({ enum: ['CHILD', 'SPOUSE', 'PARENT', 'SIBLING', 'OTHER'] })
  relation!: DependentRelation;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
