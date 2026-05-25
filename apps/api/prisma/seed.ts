/* eslint-disable no-console */
/**
 * Seed script for Phase A.
 *
 *   1. Insert canonical roles (idempotent).
 *   2. Insert the demo Hospital tenant + provision its schema.
 *   3. Insert the bootstrap super-admin with `mustRotatePassword=true`.
 *   4. Insert the 14 `*@demo.com` users specified by the action plan, password
 *      `demo123` (development only).
 *
 * Run with: `pnpm --filter @quantumed/api db:seed`
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { splitStatements } from '../src/modules/tenancy/tenant-provisioning.service';

const prisma = new PrismaClient();

interface DemoUser {
  email: string;
  fullName: string;
  roleCodes: string[];
}

const DEMO_USERS: DemoUser[] = [
  { email: 'doctor@demo.com', fullName: 'Dr. Demo Doctor', roleCodes: ['doctor'] },
  { email: 'patient@demo.com', fullName: 'Demo Patient', roleCodes: ['patient'] },
  { email: 'hr@demo.com', fullName: 'Demo HR Admin', roleCodes: ['hr_admin'] },
  { email: 'lab@demo.com', fullName: 'Demo Lab Staff', roleCodes: ['laboratorist'] },
  { email: 'pharmacy@demo.com', fullName: 'Demo Pharmacist', roleCodes: ['pharmacist'] },
  { email: 'imaging@demo.com', fullName: 'Demo Radiologist', roleCodes: ['radiologist'] },
  { email: 'reception@demo.com', fullName: 'Demo Receptionist', roleCodes: ['receptionist'] },
  {
    email: 'referral@demo.com',
    fullName: 'Demo Referral Coordinator',
    roleCodes: ['referral_coordinator'],
  },
  { email: 'accountant@demo.com', fullName: 'Demo Accountant', roleCodes: ['accountant'] },
  { email: 'patientgateway@demo.com', fullName: 'Demo Patient (Gateway)', roleCodes: ['patient'] },
  { email: 'notifications@demo.com', fullName: 'Demo Notifications Admin', roleCodes: ['admin'] },
  {
    email: 'telemed@demo.com',
    fullName: 'Demo Telemedicine Provider',
    roleCodes: ['telemedicine_provider'],
  },
  { email: 'donor@demo.com', fullName: 'Demo Donor Coordinator', roleCodes: ['donor_coordinator'] },
  { email: 'nurse@demo.com', fullName: 'Demo Nurse', roleCodes: ['nurse'] },
];

const ROLES = [
  { code: 'super_admin', displayName: 'Super Admin' },
  { code: 'admin', displayName: 'Hospital Admin' },
  { code: 'doctor', displayName: 'Doctor' },
  { code: 'nurse', displayName: 'Nurse' },
  { code: 'receptionist', displayName: 'Receptionist' },
  { code: 'accountant', displayName: 'Accountant' },
  { code: 'pharmacist', displayName: 'Pharmacist' },
  { code: 'laboratorist', displayName: 'Laboratorist' },
  { code: 'patient', displayName: 'Patient' },
  { code: 'hr_admin', displayName: 'HR Admin' },
  { code: 'department_head', displayName: 'Department Head' },
  { code: 'lab_technician', displayName: 'Lab Technician' },
  { code: 'pathologist', displayName: 'Pathologist' },
  { code: 'lab_manager', displayName: 'Lab Manager' },
  { code: 'radiologist', displayName: 'Radiologist' },
  { code: 'radiographer', displayName: 'Radiographer' },
  { code: 'imaging_technologist', displayName: 'Imaging Technologist' },
  { code: 'pharmacy_technician', displayName: 'Pharmacy Technician' },
  { code: 'referral_coordinator', displayName: 'Referral Coordinator' },
  { code: 'donor_coordinator', displayName: 'Donor Coordinator' },
  { code: 'telemedicine_provider', displayName: 'Telemedicine Provider' },
];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
}

async function ensureRoles() {
  for (const r of ROLES) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { displayName: r.displayName },
      create: { code: r.code, displayName: r.displayName, isSystem: true },
    });
  }
  console.log(`[seed] ${ROLES.length} roles ensured`);
}

async function ensureDemoHospital(): Promise<{ id: string; schemaName: string }> {
  const slug = process.env.DEMO_HOSPITAL_SLUG ?? 'demo';
  const schemaName = `tenant_${slug}`;
  const existing = await prisma.hospital.findUnique({ where: { slug } });
  if (existing) {
    console.log(`[seed] demo hospital ${slug} already present (${existing.id})`);
    return { id: existing.id, schemaName };
  }
  const created = await prisma.hospital.create({
    data: {
      name: 'Demo Hospital',
      slug,
      tier: 'STANDARD',
      isolationMode: 'SCHEMA',
      schemaName,
      defaultLocale: 'en',
      defaultTimezone: 'UTC',
      defaultCurrency: 'USD',
      status: 'ACTIVE',
      branding: { primaryColor: '#0EA5E9' },
    },
  });
  console.log(`[seed] demo hospital created (${created.id})`);
  return { id: created.id, schemaName };
}

/**
 * Provisions the tenant schema and applies the Phase B.1 clinical DDL. Safe
 * to run repeatedly — the template uses `IF NOT EXISTS` for every object.
 */
async function provisionTenantSchema(schemaName: string): Promise<void> {
  if (!/^tenant_[a-z0-9_]{1,48}$/.test(schemaName)) {
    throw new Error(`Refusing to provision invalid schema name: ${schemaName}`);
  }
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
  const ident = Prisma.raw(`"${schemaName}"`);
  await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS ${ident}`;
  await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS ${ident}.tenant_meta (
    id BIGSERIAL PRIMARY KEY,
    provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    schema_version INTEGER NOT NULL DEFAULT 1
  )`;
  const templatePath = join(__dirname, 'tenant-template.sql');
  const template = readFileSync(templatePath, 'utf8');
  const rendered = template.replaceAll('{{schema}}', `"${schemaName}"`);
  for (const stmt of splitStatements(rendered)) {
    await prisma.$executeRawUnsafe(stmt);
  }
  console.log(`[seed] tenant schema ${schemaName} provisioned (Phase B.1 DDL applied)`);
}

async function ensureUser(opts: {
  hospitalId: string | null;
  email: string;
  fullName: string;
  passwordHash: string;
  roleCodes: string[];
  mustRotatePassword?: boolean;
}) {
  const emailNormalized = normalizeEmail(opts.email);
  const existing = opts.hospitalId
    ? await prisma.user.findFirst({ where: { hospitalId: opts.hospitalId, emailNormalized } })
    : await prisma.user.findFirst({ where: { hospitalId: null, emailNormalized } });

  let userId: string;
  if (existing) {
    userId = existing.id;
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: opts.passwordHash,
        fullName: opts.fullName,
        mustRotatePassword: opts.mustRotatePassword ?? false,
        status: 'ACTIVE',
      },
    });
  } else {
    const created = await prisma.user.create({
      data: {
        hospitalId: opts.hospitalId,
        email: opts.email,
        emailNormalized,
        passwordHash: opts.passwordHash,
        fullName: opts.fullName,
        mustRotatePassword: opts.mustRotatePassword ?? false,
        status: 'ACTIVE',
      },
    });
    userId = created.id;
  }

  for (const code of opts.roleCodes) {
    const role = await prisma.role.findUnique({ where: { code } });
    if (!role) {
      console.warn(`[seed] role ${code} not found, skipping`);
      continue;
    }
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
  }
}

async function main(): Promise<void> {
  await ensureRoles();

  const superEmail = process.env.SUPER_ADMIN_BOOTSTRAP_EMAIL ?? 'superadmin@quantumed.local';
  const superPwd = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD ?? 'ChangeMeOnFirstLogin!1';
  const superHash = await hashPassword(superPwd);
  await ensureUser({
    hospitalId: null,
    email: superEmail,
    fullName: 'Bootstrap Super Admin',
    passwordHash: superHash,
    roleCodes: ['super_admin'],
    mustRotatePassword: true,
  });
  console.log(`[seed] super admin ensured (${superEmail}) — must rotate on first login`);

  const { id: demoHospitalId, schemaName: demoSchema } = await ensureDemoHospital();
  await provisionTenantSchema(demoSchema);

  const demoHash = await hashPassword('demo123');
  for (const u of DEMO_USERS) {
    await ensureUser({
      hospitalId: demoHospitalId,
      email: u.email,
      fullName: u.fullName,
      passwordHash: demoHash,
      roleCodes: u.roleCodes,
    });
  }
  console.log(`[seed] ${DEMO_USERS.length} demo users seeded against the demo hospital`);

  await prisma.package.upsert({
    where: { code: 'demo-tier-standard' },
    update: {},
    create: {
      code: 'demo-tier-standard',
      name: 'Standard',
      description: 'Demo Standard tier — included with quick-install',
      priceCents: 0,
      currency: 'USD',
      intervalDays: 30,
      features: { branding: true, telemedicine: true, smsNotifications: false },
    },
  });
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
