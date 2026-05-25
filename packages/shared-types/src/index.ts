/**
 * Shared types used by both the API and Web apps.
 *
 * Everything in this package is import-safe from both NestJS (CJS via tsc)
 * and Next.js (ESM via Bundler resolution). Keep this file dependency-free.
 */

export const SUPPORTED_LOCALES = ['en', 'ar', 'am', 'om', 'so', 'ti'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const RTL_LOCALES = ['ar'] as const satisfies readonly Locale[];

export function isRtlLocale(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

// -----------------------------------------------------------------------------
// Role and permission model
// -----------------------------------------------------------------------------

/**
 * Canonical role identifiers. The 9 base roles from the multi-agent prompt
 * plus the extended roles introduced by feature modules.
 */
export const ROLES = [
  'super_admin',
  'admin',
  'doctor',
  'nurse',
  'receptionist',
  'accountant',
  'pharmacist',
  'laboratorist',
  'patient',
  'hr_admin',
  'department_head',
  'lab_technician',
  'pathologist',
  'lab_manager',
  'radiologist',
  'radiographer',
  'imaging_technologist',
  'pharmacy_technician',
  'referral_coordinator',
  'donor_coordinator',
  'telemedicine_provider',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Resources protected by the RBAC matrix. Granted at module boundary so
 * controllers can decorate routes with `(resource, action)` tuples.
 */
export const RESOURCES = [
  'hospital',
  'user',
  'patient',
  'encounter',
  'appointment',
  'schedule',
  'prescription',
  'medicine',
  'pharmacy_inventory',
  'pos_invoice',
  'lab_test',
  'lab_order',
  'lab_result',
  'imaging_request',
  'imaging_study',
  'imaging_report',
  'telemedicine_session',
  'invoice',
  'payment',
  'employee',
  'attendance',
  'payroll',
  'donor',
  'blood_inventory',
  'referral',
  'insurance_authorization',
  'notification',
  'notification_template',
  'report',
  'audit_log',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Permission {
  resource: Resource;
  action: Action;
}

// -----------------------------------------------------------------------------
// Tenancy model
// -----------------------------------------------------------------------------

export type IsolationMode = 'SCHEMA' | 'DATABASE';
export type HospitalTier = 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';

export interface TenantContext {
  hospitalId: string;
  schemaName: string;
  isolationMode: IsolationMode;
  tier: HospitalTier;
}

// -----------------------------------------------------------------------------
// API envelope types
// -----------------------------------------------------------------------------

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  request_id: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor: string | null;
    has_more: boolean;
  };
}
