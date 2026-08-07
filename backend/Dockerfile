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

# 编译 NestJS
RUN pnpm --filter backend run build

# pnpm deploy：创建自包含生产包，所有依赖展平无 workspace 提升问题
# --prod 只保留 dependencies（排除 devDependencies）
RUN pnpm deploy --filter backend --prod /prod-bundle

# ── Stage 3: Migrator (独立运行 prisma migrate deploy) ────────────────────────
FROM builder AS migrator
WORKDIR /app
CMD ["sh", "-c", "pnpm --filter backend exec prisma migrate deploy"]

# ── Stage 4: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# pnpm deploy 已包含：package.json + node_modules（全部展平）+ 源码/dist
COPY --from=builder /prod-bundle ./

# 用构建产出的 dist/ 覆盖（pnpm deploy 可能包含旧的，确保用最新编译结果）
COPY --from=builder /app/backend/dist ./dist

# prisma schema + migrations（prisma migrate deploy 和 generate 需要）
COPY --from=builder /app/backend/prisma ./prisma

RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "dist/main"]
