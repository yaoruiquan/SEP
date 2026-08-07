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

# pnpm deploy：创建自包含生产包，所有依赖展平，无 workspace 提升问题
RUN pnpm deploy --filter backend --prod /prod-bundle

# pnpm deploy 从 registry 安装 @prisma/client，不会 generate，
# 手动将已 generate 的 .prisma/client 复制进 prod-bundle
RUN if [ -d /app/node_modules/.prisma ]; then \
      cp -r /app/node_modules/.prisma /prod-bundle/node_modules/.prisma; \
    elif [ -d /app/backend/node_modules/.prisma ]; then \
      cp -r /app/backend/node_modules/.prisma /prod-bundle/node_modules/.prisma; \
    else \
      echo "ERROR: .prisma not found after prisma generate" && exit 1; \
    fi

# ── Stage 3: Migrator (独立运行 prisma migrate deploy) ────────────────────────
FROM builder AS migrator
WORKDIR /app
CMD ["sh", "-c", "pnpm --filter backend exec prisma migrate deploy"]

# ── Stage 4: Runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# prod-bundle 包含：package.json + 展平的 node_modules（含 .prisma/client）
COPY --from=builder /prod-bundle ./

# 用最新编译产出覆盖 dist/
COPY --from=builder /app/backend/dist ./dist

# prisma schema + migrations（运行时可能需要）
COPY --from=builder /app/backend/prisma ./prisma

RUN mkdir -p uploads

EXPOSE 3001

CMD ["node", "dist/main"]
