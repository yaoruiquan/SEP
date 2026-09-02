-- 算力专款：企业钱包里划出一部分只用于与硅基员工对话的钱。
--
-- 不是第二本账 —— computeReservedCNY 是 balance 的子集，划入不增加企业总余额，
-- 只是给这部分钱贴上用途标签：订阅付费不能动它，对话扣费优先动它。
-- 存量企业默认 0（= 未启用专款），行为与现在完全一致：对话直接从钱包扣。

ALTER TABLE "enterprise_wallets"
  ADD COLUMN IF NOT EXISTS "computeReservedCNY" DECIMAL(14,6) NOT NULL DEFAULT 0;

-- 划入 / 划回的审计流水类型。这两类交易不改变 balance，
-- 只改变 computeReservedCNY，因此 balanceBefore == balanceAfter。
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'COMPUTE_RESERVE';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'COMPUTE_RELEASE';
