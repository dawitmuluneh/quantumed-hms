# Runbook — Local development

## Prerequisites

- Node.js 20.x (`.nvmrc` is pinned).
- pnpm 9.15.1 (the repo pins this via `packageManager`; `corepack enable`
  will pick it up automatically).
- Docker + Docker Compose v2 (for Postgres / Redis / MinIO / MailDev).

## First-time setup

```bash
git clone https://github.com/dawitmuluneh/quantumed-hms.git
cd quantumed-hms
corepack enable
pnpm install
cp .env.example .env
# fill in secrets if you want — defaults work for local dev
```

## Start the supporting infrastructure

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres redis minio maildev
```

This gives you:

| Service  | Host             | Notes                                |
| -------- | ---------------- | ------------------------------------ |
| Postgres | `localhost:5432` | user/pass: `quantumed` / `quantumed` |
| Redis    | `localhost:6379` |                                      |
| MinIO    | `localhost:9000` | console at `localhost:9001`          |
| MailDev  | `localhost:1080` | SMTP on 1025                         |

## Migrate and seed

```bash
pnpm --filter @quantumed/api prisma:migrate:dev
pnpm --filter @quantumed/api db:seed
```

The seed script creates:

- The `platform` schema and the `demo` tenant schema.
- One bootstrap super-admin (`SUPER_ADMIN_BOOTSTRAP_EMAIL` /
  `SUPER_ADMIN_BOOTSTRAP_PASSWORD`, default
  `admin@quantumed.io` / `ChangeMe!OnFirstLogin`, with
  `mustRotatePassword=true`).
- 14 demo users: `superadmin@demo.com`, `admin@demo.com`,
  `doctor@demo.com`, `nurse@demo.com`, `receptionist@demo.com`,
  `accountant@demo.com`, `pharmacist@demo.com`, `laboratorist@demo.com`,
  `radiologist@demo.com`, `hr@demo.com`, `referral@demo.com`,
  `donor@demo.com`, `telemedicine@demo.com`, `patient@demo.com`.
  All with password `demo123`.

## Run the apps

```bash
# Terminal 1
pnpm --filter @quantumed/api dev      # API at http://localhost:4000, docs at /api/docs

# Terminal 2
pnpm --filter @quantumed/web dev      # Web at http://localhost:3000

# Terminal 3 (optional, only when developing worker)
pnpm --filter @quantumed/worker dev
```

Or run the full stack containerised:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Common tasks

| Task               | Command                                      |
| ------------------ | -------------------------------------------- |
| Lint everything    | `pnpm lint`                                  |
| Type-check         | `pnpm typecheck`                             |
| Unit tests         | `pnpm test:unit`                             |
| Full build         | `pnpm build`                                 |
| Format             | `pnpm format`                                |
| Check formatting   | `pnpm format:check`                          |
| Open Prisma Studio | `pnpm --filter @quantumed/api prisma:studio` |

## Troubleshooting

- **"Schema `platform` does not exist":** run `prisma:migrate:dev` again. The
  multi-schema preview feature requires explicit migration application.
- **MFA fails on first login:** the demo seed disables MFA for `*@demo.com`
  accounts. To test the MFA flow, enable it manually via `pnpm
--filter @quantumed/api prisma:studio`.
- **CI fails with `format:check`:** run `pnpm format` and recommit.
