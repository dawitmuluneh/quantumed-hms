# QuantuMed HMS — Project Status

> Updated with every PR. The action plan in [`action-plan.md`](./action-plan.md)
> is the _spec_; this file is the _running tally_ of what's been built against
> it. The `README.md` phase-status table mirrors the high-level rows below.

Last updated: Phase B.3 post-merge hotfix (this PR) — `ImagingReportsService` `STATUS_TRANSITIONS` no longer allows `DRAFT → FINALIZED` directly, which was bypassing the mandatory peer-review (4-eyes) check that only fires on the `REVIEWED` transition. Also fixes a stale specimen-type list in this file. Stacked behind PR [#4](https://github.com/davidmuluneh/quantumed-hms/pull/4) (B.3 hotfix: atomic duplicate detection on `imaging_reports.create`) which is also open. PR [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2) (B.2 hotfix) and PR [#3](https://github.com/davidmuluneh/quantumed-hms/pull/3) (B.3) are both merged.

## Snapshot

| Phase | Scope                                                                                                                                                                                                                | Status                         | PRs                                                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Monorepo, scaffolds, cross-cutting (identity / tenancy / multi-hospital / audit / encryption / RBAC / i18n), demo seed, docker-compose, CI workflow                                                                  | shipped                        | [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2) (Devin Review fixes follow-up to the foundation drop), prior commits on `main`                                                |
| B.1   | Patients (MRN + PHI), encounters (vitals + ICD-10 diagnoses), scheduling (resources, weekly schedules, appointments with no-overlap GIST)                                                                            | shipped                        | [#3](https://github.com/davidmuluneh/quantumed-hms/pull/3)                                                                                                                               |
| B.2   | Prescriptions (header + line items, PHI instructions, status state machine), pharmacy (medicines catalog, lot-tracked inventory batches, atomic FEFO dispense ledger)                                                | **shipped, end-to-end tested** | [#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) + post-merge hotfix [#2](https://github.com/davidmuluneh/quantumed-hms/pull/2) — CAS on `prescriptions.status`                |
| B.3   | Lab (tests catalog + orders + items + append-only results with snapshotted ranges + 2-person verification) and imaging (requests + studies + radiologist reports with DRAFT → PENDING_REVIEW → REVIEWED → FINALIZED) | shipped + post-merge hotfixes  | [#3](https://github.com/davidmuluneh/quantumed-hms/pull/3) + open hotfix [#4](https://github.com/davidmuluneh/quantumed-hms/pull/4) (duplicate-detection race) + this PR (4-eyes bypass) |
| B.4   | Billing, HR, donor, referrals                                                                                                                                                                                        | not started                    | —                                                                                                                                                                                        |
| C     | Role-specific dashboards + complete UI                                                                                                                                                                               | not started                    | —                                                                                                                                                                                        |
| D     | Testing & quality (contract, integration, perf, security)                                                                                                                                                            | not started                    | —                                                                                                                                                                                        |
| E     | Docs, runbooks, Helm/Terraform, production readiness                                                                                                                                                                 | not started                    | —                                                                                                                                                                                        |

## What's open right now

- **This PR — Phase B.3 post-merge hotfix (clinical safety + doc accuracy)**: Devin Review flagged that `STATUS_TRANSITIONS` on `imaging-reports.service.ts:38` allowed `DRAFT → FINALIZED` directly. The self-review (4-eyes) check at `imaging-reports.service.ts:232-243` only fires when `input.status === 'REVIEWED'`, so the DRAFT → FINALIZED shortcut let an authoring radiologist finalize their own report without a peer co-signer. Fix: `DRAFT` can now only transition to `PENDING_REVIEW`, forcing every finalization to pass through `REVIEWED` (where the self-review check fires). Also fixes the specimen-type list in this file (PROJECT_STATUS.md:65 listed non-existent `SALIVA` and omitted `SERUM` / `PLASMA` / `SPUTUM`, contradicting `apps/api/src/modules/laboratory/dto/create-lab.dto.ts:28-39` and `tenant-template.sql:416-418`). New unit test `rejects DRAFT -> FINALIZED to enforce mandatory peer review` covers the regression.
- **PR [#4](https://github.com/davidmuluneh/quantumed-hms/pull/4) — Phase B.3 post-merge hotfix (still open)**: drops the pre-INSERT duplicate `SELECT` in `ImagingReportsService.create` (TOCTOU race that surfaced concurrent creates as a raw 500); wraps the INSERT in `try/catch` and translates Prisma `P2010` UNIQUE-constraint violations to typed 409 `IMAGING_REPORT_DUPLICATE`. Also adds the regression test for the `CASE WHEN ${field !== undefined}` PHI-clear fix that shipped in PR #3 without a test.
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

### Phase B.2 — Prescriptions + pharmacy

- `medicines` — formulary catalog with code, generic / brand name, form, strength, ATC code, controlled flag, default unit.
- `pharmacy_inventory_batches` — lot-tracked stock with `expires_on`; FEFO ordering on `(expires_on ASC, received_at ASC)`.
- `prescriptions` + `prescription_items` — header on an open encounter, items with dose / route / frequency / duration / PRN, status state machine `ACTIVE → {COMPLETED, CANCELLED, SUPERSEDED}` (terminal states are terminal). Status UPDATE uses compare-and-swap (`WHERE id = ? AND status = ?`) to close the TOCTOU race surfaced by post-merge Devin Review on PR #1.
- `pharmacy_dispenses` — append-only ledger. The dispense path runs entirely inside `$transaction`: `SELECT … FOR UPDATE OF i` on the prescription item serializes concurrent dispenses; the conditioned UPDATE on the batch row (`quantity_on_hand >= dispensed_qty`) plus the dispense INSERT are atomic; FEFO batch selection happens inside the same transaction when `batchId` is omitted.
- PHI fields (prescription notes, item instructions) encrypted via `FieldEncryptionService`; every state change writes through `AuditLogService`.
- **Post-merge hotfix** (this PR): `PrescriptionsService.updateStatus` now uses a compare-and-swap UPDATE (`AND status = ${expected}`) so two concurrent transitions cannot both succeed; the loser receives a 409 `PRESCRIPTION_TRANSITION_CONFLICT` and the audit log only records the winning transition. 12 test suites / 82 tests passing on this branch (+1 race unit test vs PR #1 merge).

### Phase B.3 — Laboratory + imaging

- `lab_tests` — catalog with code, name, specimen type (BLOOD / SERUM / PLASMA / URINE / STOOL / SPUTUM / CSF / SWAB / TISSUE / OTHER), unit, reference low/high, critical low/high, turnaround minutes, active flag.
- `lab_orders` — header per open encounter with priority (`ROUTINE | URGENT | STAT`), sample barcode (tenant-unique), PHI-encrypted notes. State machine: `PENDING_COLLECTION → COLLECTED → IN_PROGRESS → COMPLETED|CANCELLED`. `COMPLETED` is only reachable when every item is in `VERIFIED` or `CANCELLED`.
- `lab_order_items` — per-test rows with per-item state machine `PENDING → IN_PROGRESS → RESULTED → VERIFIED|CANCELLED` driven by result entry / verification.
- `lab_results` — **append-only** ledger. Reference and critical ranges are **snapshotted from `lab_tests` at entry time** so historical flags are immutable when the catalog is later edited. Server-side auto-flagging for numeric values (`NORMAL | LOW | HIGH | CRITICAL_LOW | CRITICAL_HIGH`); caller-supplied flag for text values. Verification rejects self-verification (verifier ≠ enterer) and requires the result to be the latest for its item.
- `imaging_requests` — header per open encounter with modality (`XRAY | CT | MRI | ULTRASOUND | MAMMOGRAPHY | FLUOROSCOPY`), body part, priority (`ROUTINE | URGENT | STAT | EMERGENCY`), PHI-encrypted clinical question, optional scheduled time. State machine: `REQUESTED → SCHEDULED → IN_PROGRESS → PERFORMED → REPORTED|CANCELLED`. `REPORTED` is only reachable as a side-effect of report finalization (callers cannot transition directly).
- `imaging_studies` — performance record with equipment id, performed-by, protocol, image count, DICOM object key list, PHI-encrypted technologist notes. Recording a study flips the parent request to `PERFORMED` inside the same transaction.
- `imaging_reports` — one-per-study radiologist report with PHI-encrypted findings / impression / recommendations. State machine: `DRAFT → PENDING_REVIEW → REVIEWED → FINALIZED` (strictly forward through every state, with regression-only edits from `PENDING_REVIEW` / `REVIEWED` back to `DRAFT`). `FINALIZED` is **only** reachable from `REVIEWED`; a draft cannot be finalized directly because that would bypass the self-review (4-eyes) check that only fires on the `REVIEWED` transition. Reviewer must differ from the authoring radiologist (`IMAGING_REPORT_SELF_REVIEW`). `FINALIZED` is a compound transition: inside one `$transaction` we CAS the report row and call `markReportedInTx()` to flip the parent request to `REPORTED`, so the two state machines cannot diverge.
- All state transitions across labs and imaging use **compare-and-swap on the status column** (`WHERE id = ? AND status = ?`), reusing the pattern introduced by the PR #2 hotfix. Zero-row UPDATE surfaces a 409 with a typed code (`LAB_ORDER_TRANSITION_CONFLICT`, `IMAGING_REQUEST_TRANSITION_CONFLICT`, `IMAGING_REPORT_TRANSITION_CONFLICT`) so the caller can reload and retry.
- 16 test suites / 121 tests passing on `main` after PR #3 merged (+5 suites / +39 tests vs Phase B.2). Adversarial coverage for CAS races, range-snapshotting, self-verification, and self-review.

## Conventions for updating this file

- Every PR updates the row(s) it touches in the **Snapshot** table and adds a bullet under **What's shipped per phase (detail)** if it adds new behavior.
- The README phase-status table mirrors the Snapshot table's _high-level_ status and PR links; keep them in sync.
- When a phase moves from `in progress` to `shipped`, link the test report (if e2e tested) in **What's shipped per phase (detail)**.
- Do not retroactively delete rows — phases stay in this file forever, marked `shipped` with their PR link, so the doc doubles as a changelog.
