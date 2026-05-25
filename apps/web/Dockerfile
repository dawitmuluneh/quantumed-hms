FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
WORKDIR /repo
RUN pnpm --filter @quantumed/web build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public 2>/dev/null || true
COPY --from=build /repo/apps/web/package.json ./
COPY --from=build /repo/node_modules ./node_modules
EXPOSE 3000
USER node
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
