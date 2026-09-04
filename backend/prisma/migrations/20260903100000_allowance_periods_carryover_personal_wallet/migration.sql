-- 算力分配规则定稿（方案 §5.4 / §5.7）：多周期 + 结转 + 追加额度 + 变更留痕 + 个人钱包。
--
-- 四个概念仍然分开：本迁移不给任何「闸门」表加 balance 字段。
-- 分配额度只约束「这个人本周期能花多少钱」，钱始终在企业钱包 / 赠送额度 / 个人钱包里。

-- ── 周期枚举 ────────────────────────────────────────────────────────────────
-- 没有 TOTAL（永不重置）：它等价于「不限额」或「一次性追加额度」。
DO $$ BEGIN
  CREATE TYPE "AllowancePeriod" AS ENUM ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PersonalWalletTransactionType" AS ENUM ('DEPOSIT', 'CONSUME', 'REFUND', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 额度类通知 ──────────────────────────────────────────────────────────────
-- 本迁移只加枚举值、不使用它们：PostgreSQL 允许在事务里 ADD VALUE，
-- 但同一事务内不能引用新值。
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ALLOWANCE_WARNING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ALLOWANCE_EXHAUSTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WALLET_LOW_BALANCE';

-- ── 额度表扩展 ──────────────────────────────────────────────────────────────
-- period 从 TEXT 转枚举用 USING 就地转换，**不 DROP + ADD**（那会丢掉存量行的周期）。
-- 存量值只有 'MONTH'，但非法值也不该让整个迁移炸掉，所以 CASE 兜一下。
ALTER TABLE "member_compute_allowances"
  ADD COLUMN IF NOT EXISTS "carryOver" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member_compute_allowances'
      AND column_name = 'period' AND data_type = 'text'
  ) THEN
    ALTER TABLE "member_compute_allowances" ALTER COLUMN "period" DROP DEFAULT;
    ALTER TABLE "member_compute_allowances"
      ALTER COLUMN "period" TYPE "AllowancePeriod"
      USING (
        CASE WHEN "period" IN ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR')
             THEN "period" ELSE 'MONTH' END
      )::"AllowancePeriod";
    ALTER TABLE "member_compute_allowances" ALTER COLUMN "period" SET DEFAULT 'MONTH';
  END IF;
END $$;

-- ── 周期窗口：结转的 O(1) 记忆化 ────────────────────────────────────────────
-- 懒创建，一个成员一个周期一行。只存 carriedInCNY，不存已用金额 ——
-- 已用继续对账单聚合，避免双写漂移。
CREATE TABLE IF NOT EXISTS "member_allowance_windows" (
  "id"             TEXT NOT NULL,
  "allowanceId"    TEXT NOT NULL,
  "periodStart"    TIMESTAMP(3) NOT NULL,
  "periodEnd"      TIMESTAMP(3) NOT NULL,
  -- 已封顶在一个周期的上限内（最多攒到 2 倍）
  "carriedInCNY"   DECIMAL(14,6) NOT NULL DEFAULT 0,
  -- 周期初的上限快照：中途改额度不重算已发生的结转
  "limitAtOpenCNY" DECIMAL(14,6),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "member_allowance_windows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_allowance_windows_allowanceId_periodStart_key"
  ON "member_allowance_windows" ("allowanceId", "periodStart");
CREATE INDEX IF NOT EXISTS "member_allowance_windows_allowanceId_periodStart_idx"
  ON "member_allowance_windows" ("allowanceId", "periodStart" DESC);

-- ── 一次性追加额度 ──────────────────────────────────────────────────────────
-- 取代草案的 `mode: ONE_TIME`：做成流水表，「算力分配」页才仍是一人一行。
-- 扣减顺序在常规周期额度之后（追加不是替代，见方案 §5.4 Q1）。
CREATE TABLE IF NOT EXISTS "member_allowance_topups" (
  "id"           TEXT NOT NULL,
  -- 不挂 allowanceId：额度被清成「不限额」会删 allowance 行，批准记录必须留下
  "enterpriseId" TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "amountCNY"    DECIMAL(14,6) NOT NULL,
  "consumedCNY"  DECIMAL(14,6) NOT NULL DEFAULT 0,
  -- 乐观锁：并发扣同一笔追加额度时避免双花
  "version"      INTEGER NOT NULL DEFAULT 0,
  "note"         TEXT,
  "grantedById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "member_allowance_topups_pkey" PRIMARY KEY ("id")
);

-- 扣减按 createdAt 升序（先批的先花完）
CREATE INDEX IF NOT EXISTS "member_allowance_topups_enterpriseId_userId_createdAt_idx"
  ON "member_allowance_topups" ("enterpriseId", "userId", "createdAt");

-- ── 额度变更留痕 ────────────────────────────────────────────────────────────
-- 成员被拦住时第一个问题是「谁改的」。这行历史很便宜，事后补很贵。
CREATE TABLE IF NOT EXISTS "member_allowance_changes" (
  "id"              TEXT NOT NULL,
  "allowanceId"     TEXT,
  "enterpriseId"    TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "fromLimitCNY"    DECIMAL(14,6),
  "toLimitCNY"      DECIMAL(14,6),
  "fromPeriod"      "AllowancePeriod",
  "toPeriod"        "AllowancePeriod",
  "fromCarryOver"   BOOLEAN,
  "toCarryOver"     BOOLEAN,
  -- 改额度当时本周期已用金额：调低到已用以下会立即拦人，这个数字是解释
  "usedAtChangeCNY" DECIMAL(14,6),
  "changedById"     TEXT,
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "member_allowance_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "member_allowance_changes_enterpriseId_userId_createdAt_idx"
  ON "member_allowance_changes" ("enterpriseId", "userId", "createdAt" DESC);

-- ── 个人钱包（兜底，扣费链最后一位）────────────────────────────────────────
-- 排最后而不是第 2 位：排第 2 位会让自掏钱的成员静默补贴公司 ——
-- 他一充值，公司的钱就永远花不到他头上。
CREATE TABLE IF NOT EXISTS "personal_wallets" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "balance"         DECIMAL(14,6) NOT NULL DEFAULT 0,
  -- 乐观锁，与 enterprise_wallets 同一套并发处理
  "version"         INTEGER NOT NULL DEFAULT 0,
  "totalDepositCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "totalConsumeCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "personal_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "personal_wallets_userId_key"
  ON "personal_wallets" ("userId");

-- 没有流水表，「我充的 ¥20 去哪了」无从回答
CREATE TABLE IF NOT EXISTS "personal_wallet_transactions" (
  "id"            TEXT NOT NULL,
  "walletId"      TEXT NOT NULL,
  "type"          "PersonalWalletTransactionType" NOT NULL,
  "amount"        DECIMAL(14,6) NOT NULL,
  "balanceBefore" DECIMAL(14,6) NOT NULL,
  "balanceAfter"  DECIMAL(14,6) NOT NULL,
  "relatedType"   TEXT,
  "relatedId"     TEXT,
  "description"   TEXT,
  "metadata"      JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     TEXT,

  CONSTRAINT "personal_wallet_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "personal_wallet_transactions_walletId_createdAt_idx"
  ON "personal_wallet_transactions" ("walletId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "personal_wallet_transactions_relatedType_relatedId_idx"
  ON "personal_wallet_transactions" ("relatedType", "relatedId");

-- ── 账单：个人自付的那一腿 + 窗口归属 ──────────────────────────────────────
-- 恒等式变为 creditPaidCNY + walletPaidCNY + personalPaidCNY + unpaidCNY == costCNY
ALTER TABLE "compute_usage_records"
  ADD COLUMN IF NOT EXISTS "personalPaidCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "personalWalletTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "allowanceWindowId" TEXT;

CREATE INDEX IF NOT EXISTS "compute_usage_records_allowanceWindowId_idx"
  ON "compute_usage_records" ("allowanceWindowId");

-- ── 外键 ────────────────────────────────────────────────────────────────────
-- ADD CONSTRAINT 没有 IF NOT EXISTS，用 DO 块保证重跑不报错。
DO $$
BEGIN
  ALTER TABLE "member_allowance_windows"
    ADD CONSTRAINT "member_allowance_windows_allowanceId_fkey"
    FOREIGN KEY ("allowanceId") REFERENCES "member_compute_allowances" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_topups"
    ADD CONSTRAINT "member_allowance_topups_enterpriseId_fkey"
    FOREIGN KEY ("enterpriseId") REFERENCES "enterprises" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_topups"
    ADD CONSTRAINT "member_allowance_topups_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_topups"
    ADD CONSTRAINT "member_allowance_topups_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_changes"
    ADD CONSTRAINT "member_allowance_changes_allowanceId_fkey"
    FOREIGN KEY ("allowanceId") REFERENCES "member_compute_allowances" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_changes"
    ADD CONSTRAINT "member_allowance_changes_enterpriseId_fkey"
    FOREIGN KEY ("enterpriseId") REFERENCES "enterprises" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_changes"
    ADD CONSTRAINT "member_allowance_changes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "member_allowance_changes"
    ADD CONSTRAINT "member_allowance_changes_changedById_fkey"
    FOREIGN KEY ("changedById") REFERENCES "users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "personal_wallets"
    ADD CONSTRAINT "personal_wallets_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "personal_wallet_transactions"
    ADD CONSTRAINT "personal_wallet_transactions_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "personal_wallets" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  ALTER TABLE "compute_usage_records"
    ADD CONSTRAINT "compute_usage_records_allowanceWindowId_fkey"
    FOREIGN KEY ("allowanceWindowId") REFERENCES "member_allowance_windows" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
