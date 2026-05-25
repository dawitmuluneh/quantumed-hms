# ADR 0002 — Schema-per-tenant tenancy with DB-per-tenant escape hatch

**Status:** Accepted (Phase A)
**Date:** 2025-05-25

## Context

QuantuMed must serve many hospitals from a single platform while keeping each
hospital's PHI strongly isolated, and must let premium / enterprise customers
opt into a dedicated database for stronger blast-radius guarantees.

## Decision

Hybrid tenancy:

- **Default tier:** `IsolationMode = SCHEMA`. A single PostgreSQL instance, one
  PostgreSQL schema per hospital (`tenant_<slug>`), plus a `platform` schema
  for cross-tenant entities (`Hospital`, `User`, `RefreshToken`, `AuditLog`,
  `Package`, `Subscription`).
- **Premium / Enterprise tier:** `IsolationMode = DATABASE`. A dedicated
  PostgreSQL database (URL stored in `Hospital.databaseUrl`). The application
  resolves the database URL at request time and routes Prisma queries to it.

Tenant context flows on a per-request basis via the `X-Tenant-Id` header (or
the request subdomain). The `TenantMiddleware` resolves the tenant, looks up
the `Hospital` row, and stores `{hospitalId, schemaName, isolationMode, tier}`
in `nestjs-cls` AsyncLocalStorage. Repositories pull the schema name from CLS
and apply `SET LOCAL search_path` (or a separate `PrismaClient` for
DATABASE-mode tenants) before any query.

The seed routine creates the `platform` schema and the `demo` tenant schema
deterministically; provisioning a new hospital triggers a `SchemaProvisioning`
job that runs the canonical tenant migration set against the new schema.

## Consequences

- Strong logical isolation between tenants without per-tenant infrastructure
  cost.
- A small, well-bounded escape hatch for tenants with regulatory or
  performance reasons to demand a dedicated DB — no rewrites required.
- Schema management complexity: every tenant migration runs N times (once per
  schema). Mitigated by the `TenantProvisioningService` and CI checks.
- Cross-tenant analytics must explicitly opt in via the `platform` schema or a
  separate analytics pipeline.

## Alternatives considered

- **Row-level tenancy with `hospital_id` columns:** simpler ops, but a single
  bug bypasses isolation. Rejected for a clinical-data SaaS.
- **DB-per-tenant for everyone:** prohibitive operational cost for small
  hospitals; rejected as the default.

## Phase plan

- **A:** `platform` schema, `TenantMiddleware`, `TenantProvisioningService`
  with a working `SCHEMA`-mode demo tenant.
- **B+:** Per-context tenant migrations, DB-mode routing, automated schema
  drift detection.
