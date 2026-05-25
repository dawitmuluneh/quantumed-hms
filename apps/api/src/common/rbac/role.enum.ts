import { ROLES, type Role } from '@quantumed/shared-types';

export { ROLES };
export type { Role };

export const CLINICAL_ROLES = new Set<Role>([
  'doctor',
  'nurse',
  'pharmacist',
  'laboratorist',
  'lab_technician',
  'pathologist',
  'lab_manager',
  'radiologist',
  'radiographer',
  'imaging_technologist',
  'pharmacy_technician',
  'telemedicine_provider',
]);
