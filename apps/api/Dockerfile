# Multi-stage Dockerfile for the NestJS API.
# Build context is the monorepo root.

# ---- 1. Install deps ----
FROM node:20-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile=false --filter @quantumed/api... --shamefully-hoist

# ---- 2. Build ----
FROM deps AS build
WORKDIR /repo
COPY apps/api apps/api
RUN pnpm --filter @quantumed/api prisma:generate \
 && pnpm --filter @quantumed/api build

# ---- 3. Runtime ----
FROM node:20-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT_API=4000

COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/packages/shared-types ./node_modules/@quantumed/shared-types
COPY --from=build /repo/packages/i18n ./node_modules/@quantumed/i18n

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:4000/api/health/live || exit 1
USER node
CMD ["node", "dist/main.js"]
