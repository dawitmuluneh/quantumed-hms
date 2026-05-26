# Phase B.2 — End-to-End Test Plan

PR: [davidmuluneh/quantumed-hms#1](https://github.com/davidmuluneh/quantumed-hms/pull/1)
Scope: Prescriptions + Pharmacy modules (medicines, lot-tracked inventory,
FEFO dispense, status state machine, audit & PHI encryption hooks).

Testing is **shell-only via curl** against a locally-running API — Phase B.2
ships backend modules only; the matching UI is Phase C. Postgres is up via
`docker compose`, the API is running on `http://localhost:4000`, demo tenant
is `demo`, and tokens for `reception@demo.com`, `doctor@demo.com`, and
`pharmacy@demo.com` (role `pharmacist`) are already captured.

The plan exercises **four tests**. Each one is designed so a broken
implementation would produce visibly different output.

---

## Test 1 — Happy path: medicine → batch → prescription → dispense → COMPLETED

This is the single end-to-end flow that proves the feature works as designed.
Each step has a concrete expected response shape; any deviation fails the
test.

| Step | Action                                                                                                                                                                                               | Pass criteria                                                                                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `POST /api/pharmacy/medicines` as pharmacist with `{code:"AMOX-500-T1", genericName:"Amoxicillin", form:"TABLET", strength:"500 mg", defaultUnit:"tab"}`                                             | HTTP **201/200**; response has non-empty `id` (UUID), `code==="AMOX-500-T1"`, `isActive===true`                                                                        |
| 1.2  | `POST /api/pharmacy/inventory/batches` as pharmacist with `{medicineId, lotNumber:"LOT-T1-001", expiresOn:"2027-12-31", quantity:100}`                                                               | HTTP 201/200; response has `quantityOnHand===100`, `unit==="tab"` (inherited from medicine.defaultUnit)                                                                |
| 1.3  | `POST /api/prescriptions` as doctor with `{encounterId, items:[{medicineId, dose:"1 tablet", route:"ORAL", frequency:"BID", durationDays:5, quantityToDispense:10, instructions:"Take with food"}]}` | HTTP 201/200; response has `status==="ACTIVE"`, `items.length===1`, `items[0].quantityToDispense===10`, `items[0].instructions==="Take with food"` (decrypted on read) |
| 1.4  | `POST /api/pharmacy/dispenses` as pharmacist with `{prescriptionItemId, quantity:10}` (no batchId — FEFO)                                                                                            | HTTP 201/200; response has `quantity===10`, `batchId===` batch from 1.2, `dispensedByUserId===` pharmacist's user id                                                   |
| 1.5  | `GET /api/pharmacy/inventory/batches/:id` for batch from 1.2                                                                                                                                         | `quantityOnHand===90` (100 − 10)                                                                                                                                       |
| 1.6  | `PATCH /api/prescriptions/:id/status` as doctor with `{status:"COMPLETED"}`                                                                                                                          | HTTP 200; response has `status==="COMPLETED"`                                                                                                                          |
| 1.7  | `GET /api/prescriptions/:id` as doctor                                                                                                                                                               | `status==="COMPLETED"`, `items[0].instructions==="Take with food"` (PHI round-trips through encrypt/decrypt cleanly)                                                   |

**Would fail if broken:** if PHI encryption silently corrupts data, step 1.3
or 1.7 would return mangled instructions. If audit chaining fails, step 1.4
would return 500 or silently no-op the inventory decrement. If FEFO is
broken, step 1.4 would return `NO_BATCH_AVAILABLE`. If status machine is
wrong, step 1.6 would return 400.

---

## Test 2 — BUG-0001 fix: concurrent dispenses must not exceed quantityToDispense

This is the adversarial test for the **first review-flagged bug**
(commit `3dbb501`). It must reproduce a state that the original code (no
`$transaction`, no `FOR UPDATE`) would let pass but the fixed code rejects.

**Setup** (using a separate medicine + batch + prescription from Test 1 to
isolate state):

1. Create medicine `AMOX-500-T2`, batch with `quantity:200`, prescription
   with `items:[{quantityToDispense:10}]`.

**Adversarial step:** 2. Fire **8 parallel** `POST /api/pharmacy/dispenses` with `{quantity:8}`
against the same `prescriptionItemId` (using `xargs -P 8`). Sum of all
requested quantities is **64**, vs only **10** allowed.

**Pass criteria:**

- Of the 8 parallel responses:
  - **Exactly 1** is 201/200 with `quantity:8`.
  - **7 are HTTP 409** (`ConflictError`). Most will report
    `DISPENSE_EXCEEDS_REMAINING` (because the first dispense set
    `already_dispensed=8`, leaving remaining=2, so 8 > 2). A small minority
    may report `INSUFFICIENT_STOCK` if they raced past the remaining check
    and lost the conditional UPDATE — both responses are acceptable proofs
    that the lock works.
- After dust settles:
  - `GET /api/pharmacy/dispenses?prescriptionItemId=...` returns exactly
    **one** row with `quantity:8`.
  - `GET /api/pharmacy/inventory/batches/:id` shows
    `quantityOnHand === 200 − 8 === 192`.

**Would fail if broken:** without the `FOR UPDATE OF i` lock + `$transaction`,
multiple parallel requests would read the same `already_dispensed=0` snapshot
and each pass the remaining check, producing **multiple** successful
dispenses totalling more than 10. Inventory would also decrement by more than 8. This is the exact patient-safety failure the fix prevents.

---

## Test 3 — FEFO: older-expiry batch must drain first

Adversarial proof that `resolveBatch()` orders by `expires_on ASC,
received_at ASC` (not by id or received_at alone).

**Setup:**

1. Create medicine `AMOX-500-T3`.
2. Receive batch A `LOT-T3-NEWER` with `expiresOn:"2030-01-01", quantity:50`.
3. _Then_ receive batch B `LOT-T3-OLDER` with `expiresOn:"2027-01-01",
quantity:50`. **B is received later but expires sooner.**
4. Create prescription with `items:[{quantityToDispense:5}]`.

**Adversarial step:** 5. `POST /api/pharmacy/dispenses {quantity:5}` **without** specifying
`batchId`.

**Pass criteria:**

- Dispense response's `batchId === batch B id` (the older-expiry one,
  received last).
- `GET /api/pharmacy/inventory/batches/:id` for batch A returns
  `quantityOnHand===50` (untouched).
- For batch B returns `quantityOnHand===45` (50 − 5).

**Would fail if broken:** if FEFO ordered by `received_at` only, batch A
(received first) would be drained instead. Decrement pattern would be
reversed.

---

## Test 4 — Status state machine: COMPLETED is terminal

Proof that `STATUS_TRANSITIONS[COMPLETED] === []` enforces a one-way state
machine.

**Setup:** Reuse the prescription from Test 1 (already in `COMPLETED`).

**Adversarial step:** `PATCH /api/prescriptions/:id/status` with
`{status:"ACTIVE"}`.

**Pass criteria:**

- HTTP **409** with body
  `error.code === "PRESCRIPTION_TRANSITION_INVALID"`.
- `GET /api/prescriptions/:id` still shows `status==="COMPLETED"`.

**Would fail if broken:** without the explicit transition table, the
prescription would silently flip back to `ACTIVE`, which is a serious
clinical-integrity failure (a completed Rx with new dispenses against it
breaks the dispense audit and the encounter timeline).

---

## Not in scope for this test pass

- **BUG-0002 atomic stock decrement + dispense INSERT** — no easy way to
  inject a synthetic INSERT failure mid-transaction without code-patching
  the dispense path. Covered by the existing unit tests in
  `dispenses.service.spec.ts` (which assert that the UPDATE and INSERT
  share a `$transaction` callback) and by code review.
- **BUG-0003 orphaned prescription header** — the per-item INSERT failure
  is not easily reachable externally because `prescriptions.service.ts`
  upfront-validates every referenced medicine in the same transaction
  (lines 122–136 in `prescriptions.service.ts`) and returns a
  deterministic 404 before the header INSERT runs. Covered by the unit
  tests in `prescriptions.service.spec.ts` and by code review.
- **Tenant isolation** — exercised by Phase A's existing test matrix; no
  new tenant entry points were added.
- **Audit log entries** — verified indirectly by 4 successful state
  transitions in Tests 1 and 4. The audit chain is exhaustively covered
  by `audit-log.service.spec.ts` from Phase A.

## Pass/fail summary line for the test report

`Tests 1, 2, 3, 4` must all pass with exact responses above. If any single
assertion deviates, mark the corresponding test failed and capture the
exact response body alongside the assertion that failed.
