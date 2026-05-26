# Agent guidance for QuantuMed HMS

This repository is delivered phase-by-phase (see `README.md` and
`agent_action_plan.md`). When making changes:

## Source of truth

- The action plan (`agent_action_plan.md` in the user's submission, mirrored
  for agents as `docs/action-plan.md` once promoted) is the canonical spec.
  Do not deviate without explicit user approval — propose, do not merge.
- The ADRs in `docs/adr/` record committed architectural choices. New
  decisions get a new ADR; do not edit accepted ADRs in place.

## Phase discipline

- A PR belongs to exactly one phase (A / B / C / D / E). Do not bundle
  cross-phase work.
- Phase A is **foundation only**: monorepo, scaffolds, cross-cutting
  concerns, identity / tenancy / multi-hospital modules, i18n, demo seed,
  docker-compose, CI. Do **not** implement clinical / ops modules in Phase A
  PRs.

## Mandatory checks before commit

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

The CI workflow at `.github/workflows/ci.yml` runs the same set. Husky +
lint-staged run `prettier --write` on staged files via `pnpm prepare`.

## Tenancy invariants

- Never query a clinical entity without a tenant context. The
  `RequireTenantGuard` and `TenantMiddleware` (in `apps/api/src/common/tenant`)
  enforce this; do not add `@SkipTenant()` to non-platform endpoints.
- The `platform` schema holds **only** cross-tenant entities (hospitals,
  users, refresh tokens, audit log, packages, subscriptions). Per-tenant
  data lives in `tenant_<slug>` schemas.

## Security invariants

- PHI fields are marked with `@Phi()` from `common/encryption/phi.decorator.ts`
  and stored encrypted via `FieldEncryptionService`.
- Every state-changing operation must write an `AuditLogService.write(...)`
  entry. Audit writes are the one place where the hash chain is computed —
  do not insert directly into `audit_log`.
- All endpoints are protected by `AuthGuard` and `RbacGuard` by default. Use
  `@Public()` and `@RequirePermission(resource, action)` deliberately.

## Repository status hygiene

- **Every PR must update both [`README.md`](README.md) (phase-status table) and
  [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) (Snapshot table +
  "What's shipped per phase" detail) as part of the same PR.** These two files
  are how a fresh reader (human or agent) figures out what's been built; out
  of date is worse than missing.
- When a phase moves to `shipped`, link the PR number on both files. If the
  PR was end-to-end tested, link the test report from `docs/testing/`
  alongside it in `PROJECT_STATUS.md`.
- The action plan (`docs/action-plan.md`) is the spec and does not get
  mutated by PRs — only `README.md` and `PROJECT_STATUS.md` move forward
  with each merge.

## Translations

- `packages/i18n/messages/en.json` is the source of truth. When adding keys,
  add them in `en.json` first.
- Non-English files (`ar`, `am`, `om`, `so`, `ti`) carry
  `__meta.status = "needs_professional_review"` until a medical-grade
  translation pass lands.
- Never delete a key — add a new key and migrate consumers.
