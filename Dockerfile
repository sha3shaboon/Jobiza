# syntax=docker/dockerfile:1.7
# One image definition, three targets: web (Next.js), worker (BullMQ), tools (migrations).

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# ── web: minimal standalone Next.js server ──────────────────────────
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 jobiza && mkdir -p /app/data && chown jobiza /app/data
COPY --from=build --chown=jobiza /app/.next/standalone ./
COPY --from=build --chown=jobiza /app/.next/static ./.next/static
COPY --from=build --chown=jobiza /app/public ./public
USER jobiza
EXPOSE 3000
CMD ["node", "server.js"]

# ── tools / worker: full source + dependencies, run with tsx ────────
FROM deps AS tools
ENV NODE_ENV=production
COPY . .
RUN useradd --system --uid 1001 jobiza && mkdir -p /app/data && chown -R jobiza /app
USER jobiza
CMD ["npm", "run", "db:migrate"]

FROM tools AS worker
CMD ["npm", "run", "worker"]
