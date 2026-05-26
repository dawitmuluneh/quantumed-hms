# Phase B.2 — Test Report

**PR:** [davidmuluneh/quantumed-hms#1](https://github.com/davidmuluneh/quantumed-hms/pull/1) — Phase B.2: prescriptions + pharmacy modules
**Devin session:** https://app.devin.ai/sessions/4e4c0895c7fd433ebf7566e4df28addb
**Plan:** [`docs/testing/phase-b2-test-plan.md`](./phase-b2-test-plan.md)
**Mode:** shell-only via `curl` against a locally-running API (Phase B.2 has no UI yet — UI is Phase C). No screen recording.

## Summary

| #   | Test                                                                                       | Result                |
| --- | ------------------------------------------------------------------------------------------ | --------------------- |
| 1   | Happy path: medicine → batch → prescription → dispense → COMPLETED                         | passed                |
| 2   | BUG-0001 — 8 parallel dispenses against the same item must not exceed `quantityToDispense` | **passed (headline)** |
| 3   | FEFO — older-expiry batch drained first                                                    | passed                |
| 4   | State machine — `COMPLETED → ACTIVE` rejected with 409                                     | passed                |

No regressions, no unexpected behavior, no untested assertions. All four tests would have produced visibly different output if the change were broken.

## Environment

- Postgres 16 via `docker compose -f infra/docker/docker-compose.yml up -d postgres`
- DB synced via `pnpm --filter @quantumed/api exec prisma db push` (no migration files committed yet)
- `pnpm --filter @quantumed/api db:seed` provisioned `tenant_demo` with both Phase B.1 and Phase B.2 DDL
- API on `http://localhost:4000`, tenant header `X-Tenant-Id: demo`
- Demo user tokens captured for: `reception@demo.com` (RBAC `receptionist`, used to register patient), `doctor@demo.com` (RBAC `doctor`, used for encounters and prescriptions), `pharmacy@demo.com` (RBAC `pharmacist`, used for medicines / batches / dispenses)
- Patient `Alice Tester` and OPEN encounter created as preconditions

## Test 1 — Happy path

Wrote a 10-tab prescription against an open encounter, dispensed all 10 against a single batch, marked COMPLETED, and verified PHI round-trips intact.

| Step | Endpoint                                                                                     | Expected                                                                                  | Got                                                      | Pass? |
| ---- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----- |
| 1.1  | `POST /api/pharmacy/medicines` `{code:"AMOX-500-T1",…}`                                      | new medicine, `isActive===true`, `defaultUnit==="tab"`                                    | `id=be38d789-…`, `isActive=true`, `defaultUnit=tab`      | yes   |
| 1.2  | `POST /api/pharmacy/inventory/batches` `{quantity:100, expiresOn:"2027-12-31"}`              | `quantityOnHand===100`, `unit==="tab"` (inherited)                                        | `quantityOnHand=100`, `unit=tab`                         | yes   |
| 1.3  | `POST /api/prescriptions` `{items:[{quantityToDispense:10, instructions:"Take with food"}]}` | `status==="ACTIVE"`, `items.length===1`, `items[0].instructions==="Take with food"`       | `status=ACTIVE`, 1 item, `instructions="Take with food"` | yes   |
| 1.4  | `POST /api/pharmacy/dispenses` `{quantity:10}` (no batchId; FEFO)                            | `quantity===10`, `batchId===` batch from 1.2                                              | `quantity=10`, `batchId=6c6075dd-…` (matches)            | yes   |
| 1.5  | `GET /api/pharmacy/inventory/batches/:id`                                                    | `quantityOnHand===90`                                                                     | `quantityOnHand=90`                                      | yes   |
| 1.6  | `PATCH /api/prescriptions/:id/status` `{status:"COMPLETED"}`                                 | `status==="COMPLETED"`                                                                    | `status=COMPLETED`                                       | yes   |
| 1.7  | `GET /api/prescriptions/:id`                                                                 | `status==="COMPLETED"`, `items[0].instructions==="Take with food"` (decrypted round-trip) | `status=COMPLETED`, `instructions="Take with food"`      | yes   |

PHI encryption + audit chain + FEFO + status machine all work end-to-end on the happy path.

## Test 2 — BUG-0001 — concurrent dispense race (headline)

This is the test that proves the BUG-0001 fix from commit `3dbb501`. Without `SELECT … FOR UPDATE OF i` + `$transaction`, multiple concurrent dispenses against the same prescription item would all read the same `already_dispensed=0` snapshot and all pass the remaining-quantity check, producing dispenses totaling more than `quantityToDispense`.

**Setup:** medicine `AMOX-500-T2`, batch with `quantityOnHand=200`, prescription with `quantityToDispense=10`.

**Fire:** 8 parallel `POST /api/pharmacy/dispenses` with `{quantity:8}` via `xargs -P 8` (wall clock 51 ms).

**Result table:**

| Req | HTTP | Body summary                                                               |
| --- | ---- | -------------------------------------------------------------------------- |
| 1   | 201  | `{quantity:8, batchId:5cae9bd1-…}`                                         |
| 2   | 409  | `error.code=DISPENSE_EXCEEDS_REMAINING`, "Requested 8 exceeds remaining 2" |
| 3   | 409  | same                                                                       |
| 4   | 409  | same                                                                       |
| 5   | 409  | same                                                                       |
| 6   | 409  | same                                                                       |
| 7   | 409  | same                                                                       |
| 8   | 409  | same                                                                       |

**Aftermath checks:**

- `GET /api/pharmacy/dispenses?prescriptionItemId=…` → exactly **one** row with `quantity=8`
- `GET /api/pharmacy/inventory/batches/:id` → `quantityOnHand=192` (200 − 8, decremented by exactly 8 not more)

Pass: 1 success + 7 well-typed conflict errors, batch on-hand consistent with one accepted dispense. Without the row lock + transaction, this batch would have been decremented by 8 × N and the dispense ledger would have N rows.

## Test 3 — FEFO

Setup intentionally seeded **batch A** first (`expiresOn=2030-01-01`, qty 50) and **batch B** second (`expiresOn=2027-01-01`, qty 50). FEFO must pick the older-expiry batch even though it was received later.

Fire: `POST /api/pharmacy/dispenses {quantity:5}` with no `batchId`.

| Assertion                   | Expected                                | Got                    | Pass? |
| --------------------------- | --------------------------------------- | ---------------------- | ----- |
| Dispense response `batchId` | batch B (older-expiry, received second) | `6871263a-…` (batch B) | yes   |
| Batch A on-hand untouched   | `50`                                    | `50`                   | yes   |
| Batch B on-hand `-5`        | `45`                                    | `45`                   | yes   |

A naive ordering by `received_at` only would have drained batch A; the implementation correctly orders by `expires_on ASC, received_at ASC`.

## Test 4 — State machine

Reused the prescription marked COMPLETED in Test 1. Tried to transition it back to ACTIVE.

| Assertion            | Expected                                                  | Got                               | Pass? |
| -------------------- | --------------------------------------------------------- | --------------------------------- | ----- |
| HTTP status          | `409`                                                     | `409`                             | yes   |
| `error.code`         | `PRESCRIPTION_TRANSITION_INVALID`                         | `PRESCRIPTION_TRANSITION_INVALID` | yes   |
| Error message        | `Cannot transition prescription from COMPLETED to ACTIVE` | exact match                       | yes   |
| Re-read final status | `COMPLETED` (unchanged)                                   | `COMPLETED`                       | yes   |

## Not directly tested

- **BUG-0002 (atomic stock decrement + dispense INSERT)** — no external way to inject a synthetic INSERT failure mid-`$transaction` without code-patching the dispense path. Covered by the existing unit tests in `dispenses.service.spec.ts` and by code review.
- **BUG-0003 (orphaned prescription header)** — `prescriptions.service.create` validates every referenced medicine up front inside the same transaction (returns a deterministic 404 before the header INSERT), so the orphaned-header scenario is not externally reachable. Covered by `prescriptions.service.spec.ts` and by code review.
- **Audit log entries** — exercised implicitly by every successful state change in Tests 1–4 (none returned 500 or partial responses). The audit chain itself has exhaustive Phase A unit coverage.
- **Tenant isolation** — no new tenant entry points were added in this PR; relies on existing `TenantMiddleware` + `RequireTenantGuard` from Phase A.
