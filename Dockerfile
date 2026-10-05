# syntax=docker/dockerfile:1
# Tafaqqah | تفقّه — production image (Next.js standalone output).
#
#   docker compose up --build            # recommended: database + migrations/seed + app
#   docker build -t tafaqqah .           # app image only (target: runner)
#
# Secrets (DATABASE_URL, GEMINI_API_KEY, ADMIN_PASSWORD, …) are passed at runtime, never baked in.
# `.env` is excluded by .dockerignore.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# OpenSSL is required by the Prisma CLI (migrations) and detected by the Prisma runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# ── Dependencies (includes the Prisma CLI and tsx used by migrations/seed) ──
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── Build ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_OUTPUT=standalone
RUN npx prisma generate && npx next build

# ── One-off job: apply migrations; seed only an empty database (no Next.js build inside) ──
FROM deps AS migrate
ENV NODE_ENV=production
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npx prisma generate
CMD ["sh", "scripts/docker-bootstrap.sh"]

# ── Runtime ──
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
