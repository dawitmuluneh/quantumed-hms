FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.1 --activate

FROM base AS build
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps/worker ./apps/worker
COPY packages ./packages
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @quantumed/worker build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/package.json ./
COPY --from=build /repo/node_modules ./node_modules
USER node
CMD ["node", "dist/main.js"]
