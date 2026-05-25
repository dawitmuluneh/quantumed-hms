# ADR 0001 — Monorepo with pnpm + Turborepo

**Status:** Accepted (Phase A)
**Date:** 2025-05-25

## Context

The QuantuMed HMS action plan calls for a Next.js 15 web app, a NestJS 10 API,
a BullMQ background worker, and a shared set of types/UI/i18n packages — all
maintained by one team and shipped from one repository.

## Decision

Adopt a **pnpm + Turborepo** monorepo with the following layout:

```
apps/
  api/      NestJS 10 (modular monolith)
  web/      Next.js 15 (App Router)
  worker/   BullMQ background worker
packages/
  shared-types/   role/resource/action matrix, locale config, tenant types
  ui/             shared design-system primitives
  i18n/           message catalogs (en/ar/am/om/so/ti)
  config-eslint/  shared ESLint configs
  config-prettier/
  config-typescript/
infra/
  docker/         local docker-compose stack
  k8s/            (placeholder for Phase E Helm charts)
docs/
  adr/            architecture decision records
  runbooks/       operational playbooks
```

- **pnpm 9** for fast, content-addressable installs and workspace `workspace:*`
  refs.
- **Turborepo 2** for `lint` / `typecheck` / `test` / `build` task graphs with
  remote-cache-ready outputs.
- **TypeScript project references** are not used in Phase A to keep the dev
  loop simple; we revisit when builds get slow.

## Consequences

- One PR can touch API + Web + types coherently — schemas stay in sync.
- A single CI workflow lints, type-checks, tests and builds everything.
- Onboarding cost: contributors must learn pnpm + Turbo. Mitigated by the
  `Makefile`-style scripts in the root `package.json` and the runbook in
  `docs/runbooks/local-dev.md`.

## Alternatives considered

- **npm/yarn workspaces:** slower installs, weaker hoisting story.
- **Nx:** powerful but heavier; we don't need Nx generators yet.
- **Polyrepo (one repo per app):** rejected — shared types + i18n would
  require an internal package registry from day one.
