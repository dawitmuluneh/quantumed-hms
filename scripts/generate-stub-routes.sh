#!/usr/bin/env bash
# Generates Phase A stub `page.tsx` files for every role-route the action plan
# mandates verbatim. Idempotent: re-running rewrites the files.
set -euo pipefail

cd "$(dirname "$0")/../apps/web/src/app/[locale]"

# Format: <relative-dir>|<i18nKey or empty>|<title (used when i18nKey empty)>|<route-path>
ROUTES=(
  'doctor/dashboard|doctor||/doctor/dashboard'
  'doctor/patients|doctor||/doctor/patients'
  'doctor/prescriptions|doctor||/doctor/prescriptions'
  'doctor/appointments|doctor||/doctor/appointments'
  'doctor/commissions|doctor||/doctor/commissions'
  'patient/dashboard|patient||/patient/dashboard'
  'patient/medical-history|patient||/patient/medical-history'
  'patient/appointments|patient||/patient/appointments'
  'patient/files|patient||/patient/files'
  'patient/billing|patient||/patient/billing'
  'hr/dashboard|hr||/hr/dashboard'
  'hr/employees|hr||/hr/employees'
  'hr/attendance|hr||/hr/attendance'
  'hr/payroll|hr||/hr/payroll'
  'hr/performance|hr||/hr/performance'
  'lab/dashboard|lab||/lab/dashboard'
  'lab/tests|lab||/lab/tests'
  'lab/results|lab||/lab/results'
  'lab/reports|lab||/lab/reports'
  'lab/quality|lab||/lab/quality'
  'pharmacy/dashboard|pharmacy||/pharmacy/dashboard'
  'pharmacy/inventory|pharmacy||/pharmacy/inventory'
  'pharmacy/dispensing|pharmacy||/pharmacy/dispensing'
  'pharmacy/purchase|pharmacy||/pharmacy/purchase'
  'pharmacy/pos|pharmacy||/pharmacy/pos'
  'imaging|imaging||/imaging'
  'imaging/requests|imaging||/imaging/requests'
  'imaging/studies|imaging||/imaging/studies'
  'imaging/reports|imaging||/imaging/reports'
  'appointments||Appointments|/appointments'
  'appointments/analytics||Appointment Analytics|/appointments/analytics'
  'schedules||Schedules|/schedules'
  'book-appointment||Book Appointment|/book-appointment'
  'resources||Resources|/resources'
  'referrals|referrals||/referrals'
  'referrals/providers|referrals||/referrals/providers'
  'referrals/process|referrals||/referrals/process'
  'insurance||Insurance|/insurance'
  'teleconsultation||Teleconsultation|/teleconsultation'
  'payments||Payments|/payments'
  'payments/gateways||Payment Gateways|/payments/gateways'
  'payments/process||Payment Processing|/payments/process'
  'payments/refunds||Refunds|/payments/refunds'
  'payments/reconciliation||Reconciliation|/payments/reconciliation'
  'patient-gateway|patient||/patient-gateway'
  'patient-gateway/messages|patient||/patient-gateway/messages'
  'patient-gateway/records|patient||/patient-gateway/records'
  'patient-gateway/appointments|patient||/patient-gateway/appointments'
  'patient-gateway/billing|patient||/patient-gateway/billing'
  'notifications||Notifications|/notifications'
  'notifications/templates||Notification Templates|/notifications/templates'
  'notifications/bulk||Bulk Notifications|/notifications/bulk'
  'notifications/automation||Notification Automation|/notifications/automation'
  'notifications/gateways||Notification Gateways|/notifications/gateways'
  'telemedicine|telemedicine||/telemedicine'
  'telemedicine/consultation|telemedicine||/telemedicine/consultation'
  'telemedicine/monitoring|telemedicine||/telemedicine/monitoring'
  'telemedicine/econsult|telemedicine||/telemedicine/econsult'
  'teleradiology|imaging||/teleradiology'
  'donor|donor||/donor'
  'donor/management|donor||/donor/management'
  'donor/inventory|donor||/donor/inventory'
  'donor/campaigns|donor||/donor/campaigns'
  'donor/lab|donor||/donor/lab'
  'super-admin/dashboard|super_admin||/super-admin/dashboard'
  'super-admin/hospitals|super_admin||/super-admin/hospitals'
  'super-admin/packages|super_admin||/super-admin/packages'
  'admin/dashboard|admin||/admin/dashboard'
  'admin/staff|admin||/admin/staff'
  'admin/departments|admin||/admin/departments'
  'admin/settings|admin||/admin/settings'
  'nurse/dashboard|nurse||/nurse/dashboard'
  'nurse/vitals|nurse||/nurse/vitals'
  'reception/dashboard||Reception Dashboard|/reception/dashboard'
  'reception/walk-ins||Walk-Ins|/reception/walk-ins'
  'accountant/dashboard||Accountant Dashboard|/accountant/dashboard'
  'accountant/invoices||Invoices|/accountant/invoices'
  'accountant/payments||Payments|/accountant/payments'
)

count=0
for entry in "${ROUTES[@]}"; do
  IFS='|' read -r dir key title path <<<"$entry"
  mkdir -p "$dir"
  if [[ -n "$key" ]]; then
    cat >"$dir/page.tsx" <<EOF
import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ModuleStub i18nKey="$key" routePath="$path" locale={locale} phase="C" />;
}
EOF
  else
    cat >"$dir/page.tsx" <<EOF
import { ModuleStub } from '@/components/module-stub';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ModuleStub title="$title" routePath="$path" locale={locale} phase="C" />;
}
EOF
  fi
  count=$((count + 1))
done

echo "Generated $count stub page.tsx files."
