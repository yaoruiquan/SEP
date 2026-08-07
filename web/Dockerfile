# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile --filter web...

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter web run build

# ── Stage 3: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@9.15 --activate

# 只复制运行所需文件，跳过 src/
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/web/package.json ./web/package.json
COPY --from=builder /app/web/node_modules ./web/node_modules
COPY --from=builder /app/web/.next ./web/.next
COPY --from=builder /app/web/public ./web/public

EXPOSE 3000

WORKDIR /app/web
CMD ["node_modules/.bin/next", "start"]
