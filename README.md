# QuantuMed HMS

> Cloud-native, multi-tenant hospital management platform.

QuantuMed HMS is a modular monolith covering 17 healthcare bounded contexts
(identity, tenancy, multi-hospital, patients, encounters, scheduling,
prescriptions, pharmacy, laboratory, imaging, telemedicine, billing, hr,
donor, referrals, notifications, reporting) plus 14+ role-specific dashboards
under a single Next.js app.

This repository ships in phases:

| Phase | Scope                                                                                                                                                                                                                 | Status                                                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Monorepo, shared packages, NestJS + Next.js scaffolds, identity / tenancy / multi-hospital, cross-cutting concerns (encryption, audit, RBAC, tenant), i18n (6 locales), demo seed, docker-compose, CI                 | shipped (PR [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2))                                                                                 |
| B.1   | Patients, encounters (with vitals + ICD-10 diagnoses), scheduling (resources, weekly schedules, appointments with no-overlap GIST)                                                                                    | shipped (PR [#3](https://github.com/davidmuluneh/quantumed-hms/pull/3))                                                                                 |
| B.2   | Prescriptions (header + line items with PHI instructions), pharmacy (medicines catalog, lot-tracked inventory, atomic FEFO dispensing)                                                                                | shipped, tested e2e (PR [#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) + hotfix [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2)) |
| B.3   | Laboratory (tests catalog, orders, items, append-only results with snapshotted ranges, 2-person verification) and imaging (requests, studies, radiologist reports with DRAFT → PENDING_REVIEW → REVIEWED → FINALIZED) | in progress (PR #3)                                                                                                                                     |
| B.4   | Billing, hr, donor, referrals                                                                                                                                                                                         | upcoming                                                                                                                                                |
| C     | Role-specific dashboards + complete UI                                                                                                                                                                                | upcoming                                                                                                                                                |
| D     | Testing & quality (contract, integration, perf, security)                                                                                                                                                             | upcoming                                                                                                                                                |
| E     | Docs, runbooks, Helm/Terraform, production readiness                                                                                                                                                                  | upcoming                                                                                                                                                |

Live repository status — what's shipped, what's open, what's next — is tracked in [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) and updated with every PR.

## Quick start

```bash
corepack enable && pnpm install
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d postgres redis minio maildev
pnpm --filter @quantumed/api prisma:migrate:dev
pnpm --filter @quantumed/api db:seed
pnpm dev
```

Web → http://localhost:3000 · API → http://localhost:4000 ·
API docs → http://localhost:4000/api/docs

Full local-dev instructions: [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md).

## Demo users

All seeded `*@demo.com` users share password `demo123` — for development only. A bootstrap super-admin is also created as `superadmin@quantumed.local` with the password from `SUPER_ADMIN_BOOTSTRAP_PASSWORD` (default `ChangeMeOnFirstLogin!1`, `mustRotatePassword=true`).

| Email                     | Role                  |
| ------------------------- | --------------------- |
| `doctor@demo.com`         | doctor                |
| `nurse@demo.com`          | nurse                 |
| `reception@demo.com`      | receptionist          |
| `accountant@demo.com`     | accountant            |
| `pharmacy@demo.com`       | pharmacist            |
| `lab@demo.com`            | laboratorist          |
| `imaging@demo.com`        | radiologist           |
| `hr@demo.com`             | hr_admin              |
| `referral@demo.com`       | referral_coordinator  |
| `donor@demo.com`          | donor_coordinator     |
| `telemed@demo.com`        | telemedicine_provider |
| `notifications@demo.com`  | admin                 |
| `patient@demo.com`        | patient               |
| `patientgateway@demo.com` | patient               |

`apps/api/prisma/seed.ts` is the source of truth for this list; the action plan calls for 14 `*@demo.com` accounts plus the bootstrap super-admin.

## Architecture

- **Monorepo**: pnpm 9 + Turborepo 2 — see [ADR 0001](docs/adr/0001-monorepo-pnpm-turborepo.md).
- **Tenancy**: schema-per-tenant default, DB-per-tenant for premium —
  see [ADR 0002](docs/adr/0002-multi-tenancy-schema-per-tenant.md).
- **Encryption**: field-level AES-256-GCM envelope encryption with per-tenant
  DEKs — see [ADR 0003](docs/adr/0003-field-level-encryption.md).
- **Audit log**: append-only with SHA-256 hash chain — see
  [ADR 0004](docs/adr/0004-audit-log-hash-chain.md).
- **AI/ML**: pluggable adapters; rules-based default — see
  [ADR 0005](docs/adr/0005-ai-ml-adapter.md).

## Languages

Six locales, loaded dynamically by `next-intl` from
[`packages/i18n/messages`](packages/i18n/messages):

| Locale | Language | Direction | Status                         |
| ------ | -------- | --------- | ------------------------------ |
| `en`   | English  | LTR       | source of truth                |
| `ar`   | Arabic   | RTL       | needs professional review (MT) |
| `am`   | Amharic  | LTR       | needs professional review (MT) |
| `om`   | Oromo    | LTR       | needs professional review (MT) |
| `so`   | Somali   | LTR       | needs professional review (MT) |
| `ti`   | Tigrigna | LTR       | needs professional review (MT) |

## Repository layout

```
apps/
  api/         NestJS 10 modular monolith
                 Phase A:   identity, tenancy, multi-hospital, audit, encryption, RBAC
                 Phase B.1: patients, encounters, scheduling
                 Phase B.2: prescriptions, pharmacy (medicines, inventory, dispenses)
                 Phase B.3: laboratory (tests, orders, results), imaging (requests, studies, reports)
  web/         Next.js 15 App Router with next-intl, RTL support, role-route stubs
  worker/      BullMQ background worker (scaffold)
packages/
  shared-types/ role × resource × action matrix, locale config, tenant types
  ui/           shared UI primitives (button, card, cn util)
  i18n/         message catalogs (en, ar, am, om, so, ti)
  config-*/     shared eslint, prettier, tsconfig
infra/
  docker/       docker-compose stack
  k8s/          (Phase E)
docs/
  adr/          architecture decision records
  runbooks/     operational playbooks
```

## License

UNLICENSED — proprietary. See [LICENSE](LICENSE).
