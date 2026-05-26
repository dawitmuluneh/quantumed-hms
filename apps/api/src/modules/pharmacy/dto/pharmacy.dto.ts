import { ApiProperty } from '@nestjs/swagger';

export type MedicineForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'INJECTION'
  | 'CREAM'
  | 'DROPS'
  | 'INHALER'
  | 'PATCH'
  | 'OTHER';

export class MedicineDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() genericName!: string;
  @ApiProperty({ nullable: true, required: false }) brandName?: string | null;
  @ApiProperty({
    enum: [
      'TABLET',
      'CAPSULE',
      'SYRUP',
      'INJECTION',
      'CREAM',
      'DROPS',
      'INHALER',
      'PATCH',
      'OTHER',
    ],
  })
  form!: MedicineForm;
  @ApiProperty({ nullable: true, required: false }) strength?: string | null;
  @ApiProperty({ nullable: true, required: false }) atcCode?: string | null;
  @ApiProperty() isControlled!: boolean;
  @ApiProperty() defaultUnit!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class InventoryBatchDto {
  @ApiProperty() id!: string;
  @ApiProperty() medicineId!: string;
  @ApiProperty() lotNumber!: string;
  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' }) expiresOn!: string;
  @ApiProperty() quantityOnHand!: number;
  @ApiProperty() unit!: string;
  @ApiProperty({ nullable: true, required: false }) location?: string | null;
  @ApiProperty() receivedAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class DispenseDto {
  @ApiProperty() id!: string;
  @ApiProperty() prescriptionItemId!: string;
  @ApiProperty() batchId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unit!: string;
  @ApiProperty() dispensedByUserId!: string;
  @ApiProperty() dispensedAt!: string;
  @ApiProperty({ nullable: true, required: false }) notes?: string | null;
  @ApiProperty() createdAt!: string;
}
