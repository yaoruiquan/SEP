-- 统一人民币算力余额：EnterpriseWallet 成为唯一主账本，
-- 订阅赠送额度改为人民币（SubscriptionCredit），Token 只留在用量明细里。

-- ── 1. 员工级「订阅赠送算力（元）」改为三态 ──────────────────────────────────
-- null = 未配置（取系统默认值 DEFAULT_EMPLOYEE_GIFT_CNY）、0 = 明确不赠送、>0 = 员工级覆盖。
-- 存量行一律置 NULL：该字段此前没有任何写入路径（管理端 DTO 会把它丢掉），
-- 所有 0 都是列默认值而非运营的决定，当成「未配置」才符合事实。
ALTER TABLE "digital_employees"
  ALTER COLUMN "includedComputeCNY" DROP NOT NULL,
  ALTER COLUMN "includedComputeCNY" DROP DEFAULT;

UPDATE "digital_employees" SET "includedComputeCNY" = NULL WHERE "includedComputeCNY" = 0;

-- ── 2. 钱包与流水放宽到 6 位小数 ─────────────────────────────────────────────
-- 单条对话成本常低于 1 分（便宜模型一次问答约 ¥0.003）。按分取整要么把这类消费
-- 变成免费，要么按 3 倍多收，两者都不可接受。加宽标度不丢失任何已有数据。
ALTER TABLE "enterprise_wallets"
  ALTER COLUMN "balance" TYPE DECIMAL(14,6),
  ALTER COLUMN "frozenAmount" TYPE DECIMAL(14,6),
  ALTER COLUMN "totalDeposit" TYPE DECIMAL(14,6),
  ALTER COLUMN "totalConsume" TYPE DECIMAL(14,6),
  ALTER COLUMN "totalRefund" TYPE DECIMAL(14,6);

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14,6),
  ALTER COLUMN "balanceBefore" TYPE DECIMAL(14,6),
  ALTER COLUMN "balanceAfter" TYPE DECIMAL(14,6);

-- ── 3. 订阅赠送人民币余额 ────────────────────────────────────────────────────
CREATE TABLE "subscription_credits" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "grantedCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "usedCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_credits_subscriptionId_key" ON "subscription_credits"("subscriptionId");
CREATE INDEX "subscription_credits_enterpriseId_status_idx" ON "subscription_credits"("enterpriseId", "status");
CREATE INDEX "subscription_credits_employeeId_idx" ON "subscription_credits"("employeeId");

ALTER TABLE "subscription_credits" ADD CONSTRAINT "subscription_credits_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_credits" ADD CONSTRAINT "subscription_credits_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_credits" ADD CONSTRAINT "subscription_credits_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. 单次模型调用的用量账单 ────────────────────────────────────────────────
CREATE TABLE "compute_usage_records" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "creditId" TEXT,
    "employeeId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "messageId" TEXT,
    "modelId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "inputPriceUsdPerMillion" DECIMAL(14,6) NOT NULL,
    "outputPriceUsdPerMillion" DECIMAL(14,6) NOT NULL,
    "usdToCnyRate" DECIMAL(10,4) NOT NULL,
    "fallbackPricing" BOOLEAN NOT NULL DEFAULT false,
    "costCNY" DECIMAL(14,6) NOT NULL,
    "creditPaidCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "walletPaidCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "unpaidCNY" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "walletTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compute_usage_records_pkey" PRIMARY KEY ("id")
);

-- 幂等键的唯一约束是防重复扣费的最后一道防线：流式对话的网络重试会重复触发计费。
CREATE UNIQUE INDEX "compute_usage_records_idempotencyKey_key" ON "compute_usage_records"("idempotencyKey");
CREATE INDEX "compute_usage_records_enterpriseId_createdAt_idx" ON "compute_usage_records"("enterpriseId", "createdAt" DESC);
CREATE INDEX "compute_usage_records_subscriptionId_createdAt_idx" ON "compute_usage_records"("subscriptionId", "createdAt" DESC);
CREATE INDEX "compute_usage_records_sessionId_idx" ON "compute_usage_records"("sessionId");
CREATE INDEX "compute_usage_records_creditId_idx" ON "compute_usage_records"("creditId");

ALTER TABLE "compute_usage_records" ADD CONSTRAINT "compute_usage_records_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 以下一律 SET NULL：账单是财务记录，关联实体被删不该让历史账单凭空消失。
ALTER TABLE "compute_usage_records" ADD CONSTRAINT "compute_usage_records_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compute_usage_records" ADD CONSTRAINT "compute_usage_records_creditId_fkey"
  FOREIGN KEY ("creditId") REFERENCES "subscription_credits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compute_usage_records" ADD CONSTRAINT "compute_usage_records_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compute_usage_records" ADD CONSTRAINT "compute_usage_records_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
