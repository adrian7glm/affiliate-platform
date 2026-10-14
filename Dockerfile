# syntax=docker/dockerfile:1.7
#
# Images for the whole platform, one target each (see docs/deploy.md):
#   docker build --target api    -t affiliate-api .
#   docker build --target worker -t affiliate-worker .
#   docker build --target web    -t affiliate-web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .

ARG NODE_IMAGE=node:22.22.0-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# --- API and worker: build the API and the packages it uses, then keep only what runs ---------
FROM base AS build-api
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "@ap/api..." run build
RUN pnpm --filter @ap/api deploy --prod --legacy /out/api

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    PORT=4000 \
    LOG_FORMAT=json \
    MIGRATE_ON_START=true \
    WORKER_ENABLED=false
WORKDIR /app
COPY --from=build-api --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# The background worker: same code, no HTTP server. Run exactly one.
FROM api AS worker
ENV WORKER_ENABLED=true
HEALTHCHECK NONE
CMD ["node", "dist/worker.js"]

# --- Web app: Next.js standalone server ----------------------------------------------------------
FROM base AS build-web
# Inlined in the browser code at build time.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_DEFAULT_LANG=ro
ARG NEXT_PUBLIC_DEFAULT_TIMEZONE=Europe/Bucharest
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEFAULT_LANG=$NEXT_PUBLIC_DEFAULT_LANG \
    NEXT_PUBLIC_DEFAULT_TIMEZONE=$NEXT_PUBLIC_DEFAULT_TIMEZONE \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "set --build-arg NEXT_PUBLIC_API_URL=https://..." && exit 1)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "@ap/web..." run build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build-web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
