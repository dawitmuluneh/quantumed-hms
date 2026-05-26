# QuantuMed HMS — Project Status

> Updated with every PR. The action plan in [`action-plan.md`](./action-plan.md)
> is the _spec_; this file is the _running tally_ of what's been built against
> it. The `README.md` phase-status table mirrors the high-level rows below.

Last updated: PR [#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) — Phase B.2 prescriptions + pharmacy.

## Snapshot

| Phase | Scope                                                                                                                                                                 | Status                         | PRs                                                                                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Monorepo, scaffolds, cross-cutting (identity / tenancy / multi-hospital / audit / encryption / RBAC / i18n), demo seed, docker-compose, CI workflow                   | shipped                        | [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2) (Devin Review fixes follow-up to the foundation drop), prior commits on `main` |
| B.1   | Patients (MRN + PHI), encounters (vitals + ICD-10 diagnoses), scheduling (resources, weekly schedules, appointments with no-overlap GIST)                             | shipped                        | [#3](https://github.com/davidmuluneh/quantumed-hms/pull/3)                                                                                |
| B.2   | Prescriptions (header + line items, PHI instructions, status state machine), pharmacy (medicines catalog, lot-tracked inventory batches, atomic FEFO dispense ledger) | **shipped, end-to-end tested** | [#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) (this PR)                                                                      |
| B.3   | Lab + imaging (orders, results, reports)                                                                                                                              | not started                    | —                                                                                                                                         |
| B.4   | Billing, HR, donor, referrals                                                                                                                                         | not started                    | —                                                                                                                                         |
| C     | Role-specific dashboards + complete UI                                                                                                                                | not started                    | —                                                                                                                                         |
| D     | Testing & quality (contract, integration, perf, security)                                                                                                             | not started                    | —                                                                                                                                         |
| E     | Docs, runbooks, Helm/Terraform, production readiness                                                                                                                  | not started                    | —                                                                                                                                         |

## What's open right now

- **PR [#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) — Phase B.2: prescriptions + pharmacy** — ready for merge.
  - Devin Review surfaced three transactionality bugs on the initial commit; all fixed in `3dbb501` (wrapping multi-step writes in `$transaction`, `SELECT … FOR UPDATE OF i` on the prescription item to serialize concurrent dispenses).
  - End-to-end tested against a local API: happy path, 8 parallel dispenses (1 success / 7 conflicts), FEFO older-expiry batch chosen first, state machine rejects `COMPLETED → ACTIVE`. Report: [`docs/testing/phase-b2-test-report.md`](./testing/phase-b2-test-report.md).
- **Hosted CI** is **disabled** on the GitHub repo (`.github/workflows/ci.yml` exists but `gh api repos/.../actions/workflows` returns 0). `git_pr_checks` reads 0/0/0; local `pnpm format:check / lint / typecheck / test:unit / build` are the substitute today. Enable under Settings → Actions → General to turn on hosted CI.

## What's shipped per phase (detail)

### Phase A — Foundation

Modular NestJS monolith with multi-tenant Postgres (schema-per-tenant) and a Next.js 15 app shell.

- Identity: email + password, refresh tokens, MFA stub, password rotation flag.
- Tenancy: `TenantMiddleware` resolves `X-Tenant-Id` (id _or_ slug) into a tenant context held in CLS; `RequireTenantGuard` enforces presence on clinical routes; `tenant_<slug>` schema per tenant with idempotent provisioning from `apps/api/prisma/tenant-template.sql`.
- Multi-hospital: hospitals + packages + subscriptions on the `platform` schema.
- Cross-cutting concerns:
  - Field-level AES-256-GCM envelope encryption via `FieldEncryptionService` + `@Phi()` decorator (ADR-0003).
  - Append-only `audit_log` with SHA-256 hash chain, serializable-isolation retry loop, and canonical key ordering (ADR-0004).
  - RBAC matrix in `apps/api/src/common/rbac/permissions.matrix.ts` driving the `RbacGuard` and `@RequirePermission(resource, action)` decorator.
- i18n: `packages/i18n/messages/{en,ar,am,om,so,ti}.json` with `__meta.status` flagging non-English files for professional review.
- Demo seed: 21 canonical roles, 14 `*@demo.com` users + bootstrap super-admin, demo hospital `slug=demo` with `tenant_demo` provisioned.
- Infrastructure: docker-compose for Postgres / Redis / MinIO / MailDev. CI workflow committed (not yet enabled on the GitHub repo).

### Phase B.1 — Patients, encounters, scheduling

- `patients` — MRN auto-generation, PHI fields encrypted at rest, dependents (parent-child links).
- `encounters` — `OUTPATIENT | INPATIENT | EMERGENCY | TELEMEDICINE`, vitals (height/weight/BMI auto, BP, SpO2, pulse, temp), ICD-10 diagnoses.
- `scheduling` — resources (rooms, equipment), weekly schedules, appointments with PostgreSQL EXCLUDE-USING-GIST no-overlap enforcement.

### Phase B.2 — Prescriptions + pharmacy (this PR)

- `medicines` — formulary catalog with code, generic / brand name, form, strength, ATC code, controlled flag, default unit.
- `pharmacy_inventory_batches` — lot-tracked stock with `expires_on`; FEFO ordering on `(expires_on ASC, received_at ASC)`.
- `prescriptions` + `prescription_items` — header on an open encounter, items with dose / route / frequency / duration / PRN, status state machine `ACTIVE → {COMPLETED, CANCELLED, SUPERSEDED}` (terminal states are terminal).
- `pharmacy_dispenses` — append-only ledger. The dispense path runs entirely inside `$transaction`: `SELECT … FOR UPDATE OF i` on the prescription item serializes concurrent dispenses; the conditioned UPDATE on the batch row (`quantity_on_hand >= dispensed_qty`) plus the dispense INSERT are atomic; FEFO batch selection happens inside the same transaction when `batchId` is omitted.
- PHI fields (prescription notes, item instructions) encrypted via `FieldEncryptionService`; every state change writes through `AuditLogService`.
- 11 test suites / 81 tests passing.

## Conventions for updating this file

- Every PR updates the row(s) it touches in the **Snapshot** table and adds a bullet under **What's shipped per phase (detail)** if it adds new behavior.
- The README phase-status table mirrors the Snapshot table's _high-level_ status and PR links; keep them in sync.
- When a phase moves from `in progress` to `shipped`, link the test report (if e2e tested) in **What's shipped per phase (detail)**.
- Do not retroactively delete rows — phases stay in this file forever, marked `shipped` with their PR link, so the doc doubles as a changelog.
