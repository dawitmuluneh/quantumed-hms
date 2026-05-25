# ADR 0004 — Append-only audit log with SHA-256 hash chain

**Status:** Accepted (Phase A)
**Date:** 2025-05-25

## Context

Healthcare regulators (HIPAA, GDPR, local equivalents in target markets)
require tamper-evident audit trails. A simple "audit table" is necessary but
not sufficient: a DB-admin can edit or delete rows.

## Decision

The `audit_log` table in the `platform` schema is append-only by convention
and **tamper-evident by construction**:

- Each row stores `prev_hash` (previous row's hash) and `hash` (this row's
  hash).
- `hash = SHA256(pepper || 0x1f || prev_hash || 0x1f || canonical_payload)`,
  where:
  - `pepper` is `AUDIT_HASH_PEPPER` (a server-side secret, distinct from any
    encryption key).
  - `0x1f` (ASCII unit separator) prevents canonicalisation ambiguity.
  - `canonical_payload` is the **stable** JSON serialisation of
    `{hospitalId, actorUserId, action, resource, resourceId, outcome, payload}`.
- A nightly worker (Phase B+) walks the chain head-to-tail and alerts on the
  first mismatch.

Writes go through `AuditLogService.write(input)` which:

1. Locks the most recent row in a SERIALIZABLE transaction.
2. Computes the new hash.
3. Inserts the row.

The whole chain is per-hospital (chains start at `prev_hash = NULL`) so a
single corrupt chain does not invalidate other tenants.

## Consequences

- Any in-place modification breaks the chain — the verifier detects it within
  one day.
- The pepper rotation procedure (Phase D) requires re-hashing the chain;
  documented in `docs/runbooks/audit-pepper-rotation.md` (placeholder).
- The SERIALIZABLE lock serialises audit writes per hospital. Throughput
  testing in Phase D will determine if we need to shard the chain by day.

## Alternatives considered

- **Trust the DB:** insufficient — DB admins are in scope for the threat
  model.
- **Merkle tree per day:** more elegant, more code. Hash chain is simpler and
  meets the regulatory bar.
- **External append-only log (e.g. AWS QLDB):** vendor lock-in; revisited in
  Phase E when we know production target cloud.
