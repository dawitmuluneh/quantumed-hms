import type { Action, Resource, Role } from '@quantumed/shared-types';

/**
 * Canonical (role -> resource -> actions) matrix. Read-only at runtime; the
 * RBAC guard performs O(1) lookups on this map. Phase A captures only the
 * routes that exist today; subsequent phases extend.
 */
const ALL: Action[] = ['create', 'read', 'update', 'delete', 'manage'];
const READ_ONLY: Action[] = ['read'];

type Matrix = Partial<Record<Role, Partial<Record<Resource, Action[]>>>>;

export const PERMISSIONS_MATRIX: Matrix = {
  super_admin: {
    hospital: ALL,
    user: ALL,
    audit_log: READ_ONLY,
    report: READ_ONLY,
  },
  admin: {
    hospital: ['read', 'update'],
    user: ALL,
    audit_log: READ_ONLY,
    patient: ALL,
    encounter: ALL,
    appointment: ALL,
    schedule: ALL,
    invoice: ALL,
    payment: ALL,
    notification: ALL,
    notification_template: ALL,
    employee: ALL,
    attendance: ALL,
    payroll: ALL,
    medicine: ALL,
    pharmacy_inventory: ALL,
    pos_invoice: ALL,
    lab_test: ALL,
    lab_order: ALL,
    lab_result: ALL,
    imaging_request: ALL,
    imaging_study: ALL,
    imaging_report: ALL,
    referral: ALL,
    insurance_authorization: ALL,
    donor: ALL,
    blood_inventory: ALL,
    report: ALL,
  },
  doctor: {
    patient: ['read', 'update'],
    encounter: ALL,
    appointment: ['read', 'update'],
    prescription: ['create', 'read', 'update'],
    lab_order: ['create', 'read'],
    lab_result: READ_ONLY,
    imaging_request: ['create', 'read'],
    imaging_report: READ_ONLY,
    telemedicine_session: ['create', 'read'],
  },
  nurse: {
    patient: READ_ONLY,
    encounter: ['read', 'update'],
    appointment: READ_ONLY,
    lab_result: READ_ONLY,
  },
  receptionist: {
    patient: ['create', 'read', 'update'],
    appointment: ALL,
    schedule: READ_ONLY,
  },
  accountant: {
    invoice: ALL,
    payment: ALL,
    report: READ_ONLY,
  },
  pharmacist: {
    medicine: ALL,
    pharmacy_inventory: ALL,
    pos_invoice: ALL,
    prescription: ['read', 'update'],
  },
  laboratorist: {
    lab_test: ALL,
    lab_order: ['read', 'update'],
    lab_result: ALL,
  },
  patient: {
    patient: READ_ONLY,
    appointment: ['create', 'read'],
    prescription: READ_ONLY,
    invoice: READ_ONLY,
    payment: ['create', 'read'],
  },
  hr_admin: {
    employee: ALL,
    attendance: ALL,
    payroll: ALL,
  },
  radiologist: {
    imaging_request: ['read', 'update'],
    imaging_study: ALL,
    imaging_report: ALL,
  },
  donor_coordinator: {
    donor: ALL,
    blood_inventory: ALL,
  },
  referral_coordinator: {
    referral: ALL,
    insurance_authorization: ALL,
  },
  telemedicine_provider: {
    telemedicine_session: ALL,
  },
};

/**
 * Returns true if any of the supplied roles can perform `action` on `resource`.
 * `manage` is treated as a superset of all CRUD actions.
 */
export function isPermitted(
  roles: ReadonlyArray<string>,
  resource: Resource,
  action: Action,
): boolean {
  for (const role of roles) {
    const entry = PERMISSIONS_MATRIX[role as Role];
    const actions = entry?.[resource];
    if (!actions) continue;
    if (actions.includes('manage') || actions.includes(action)) return true;
  }
  return false;
}
