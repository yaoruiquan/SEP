# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile --filter backend...

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY . .

# 先生成 Prisma Client，否则 TypeScript 编译找不到枚举类型
RUN pnpm --filter backend exec prisma generate

RUN pnpm --filter backend run build

# ── Stage 3: Migrator (独立运行 prisma migrate deploy) ────────────────────────
# 直接复用 builder：pnpm + prisma CLI 均已就位，无需重新安装
FROM builder AS migrator
WORKDIR /app
CMD ["sh", "-c", "pnpm --filter backend exec prisma migrate deploy"]

# ── Stage 4: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./package.json
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/node_modules ./node_modules

RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "dist/main"]
