-- 算力分配：给碳基员工（企业成员）设本周期的算力消费上限。
--
-- 闸门表，不是账户表：这里没有 balance 字段。设了上限不会从企业算力余额里
-- 预先划走钱，只在成员本周期已花到上限时拦下他的下一次对话。
-- 没有记录 = 不限额，与加这张表之前的行为完全一致。

CREATE TABLE IF NOT EXISTS "member_compute_allowances" (
  "id"           TEXT NOT NULL,
  "enterpriseId" TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  -- NULL = 不限额
  "limitCNY"     DECIMAL(14,6),
  "period"       TEXT NOT NULL DEFAULT 'MONTH',
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "member_compute_allowances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "member_compute_allowances_enterpriseId_userId_key"
  ON "member_compute_allowances" ("enterpriseId", "userId");

CREATE INDEX IF NOT EXISTS "member_compute_allowances_userId_idx"
  ON "member_compute_allowances" ("userId");

ALTER TABLE "member_compute_allowances"
  ADD CONSTRAINT "member_compute_allowances_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "member_compute_allowances"
  ADD CONSTRAINT "member_compute_allowances_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 闸门每轮对话都要按「成员 + 本周期」聚合已用金额，没有这个索引会全表扫账单
CREATE INDEX IF NOT EXISTS "compute_usage_records_userId_createdAt_idx"
  ON "compute_usage_records" ("userId", "createdAt" DESC);
