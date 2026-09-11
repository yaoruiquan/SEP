-- 管理员给成员充值企业算力：余额从企业钱包转入成员充值批次。
ALTER TABLE "compute_usage_records"
  ADD COLUMN IF NOT EXISTS "memberWalletPaidCNY" DECIMAL(14,6) NOT NULL DEFAULT 0;
