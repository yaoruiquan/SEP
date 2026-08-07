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

# 生成 Prisma Client（含 UserRole 等枚举），必须在 nest build 之前
RUN pnpm --filter backend exec prisma generate

# 编译 NestJS
RUN pnpm --filter backend run build

# pnpm deploy：创建自包含生产包，所有依赖展平（prod only）
RUN pnpm deploy --filter backend --prod /prod-bundle

# pnpm deploy 从 registry 安装 @prisma/client，没有 generated files
# 用 workspace 的 prisma CLI 在 prod-bundle 内重新 generate（输出到 prod-bundle/node_modules/.prisma/client）
RUN cp -r /app/backend/prisma /prod-bundle/prisma && \
    cd /prod-bundle && \
    /app/node_modules/.bin/prisma generate --schema=prisma/schema.prisma && \
    rm -rf /prod-bundle/prisma

# ── Stage 3: Migrator (独立运行 prisma migrate deploy) ────────────────────────
FROM builder AS migrator
WORKDIR /app
CMD ["sh", "-c", "pnpm --filter backend exec prisma migrate deploy"]

# ── Stage 4: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# prod-bundle：package.json + 展平 node_modules + .prisma/client（含 UserRole enum）
COPY --from=builder /prod-bundle ./

# 用最新编译产出覆盖 dist/
COPY --from=builder /app/backend/dist ./dist

# prisma schema + migrations（供 health check / 运行时读取）
COPY --from=builder /app/backend/prisma ./prisma

RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "dist/main"]
