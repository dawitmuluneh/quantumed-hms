# Runbook — Incident response (skeleton)

> Phase A skeleton. Phase E will expand each section with on-call paging,
> escalation paths, and post-mortem templates.

## Severity matrix

| Sev | Definition                                         | Response  |
| --- | -------------------------------------------------- | --------- |
| 1   | Full outage, PHI breach, or active data corruption | < 15 min  |
| 2   | Major degradation affecting > 1 hospital           | < 1 hour  |
| 3   | Single-tenant impact or recoverable degradation    | < 4 hours |
| 4   | Cosmetic / non-functional impact                   | next day  |

## On a suspected PHI breach

1. **Containment** — disable affected user accounts via super-admin console.
   Rotate all relevant secrets (`JWT_*`, `ENCRYPTION_MASTER_KEY` if exposed,
   `AUDIT_HASH_PEPPER`).
2. **Preservation** — snapshot the `audit_log` table for the affected
   tenant(s). Run the hash-chain verifier to detect tampering.
3. **Notification** — see `docs/runbooks/breach-notification.md` (Phase E).

## On a suspected audit-chain break

1. Run `pnpm --filter @quantumed/api audit:verify` (Phase B+).
2. The verifier prints `(hospitalId, audit_log.id)` of the first mismatching
   row. Stop processing for that tenant and page the on-call.

## On an MFA lockout

1. The user can self-recover by completing the recovery-code flow (Phase B).
2. If recovery codes are lost, a hospital admin can reset MFA via
   `POST /users/:id/mfa/reset` (Phase B) — this writes an `auth.mfa.reset`
   audit entry with the admin's `actorUserId`.
