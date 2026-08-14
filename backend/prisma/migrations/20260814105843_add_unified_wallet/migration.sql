-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('DEPOSIT', 'CONSUME', 'REFUND', 'ADJUSTMENT', 'FREEZE', 'UNFREEZE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDING', 'REFUNDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ALIPAY', 'WECHAT', 'BALANCE');

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'TERMINATED';

-- CreateTable
CREATE TABLE "enterprise_wallets" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "frozenAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "totalDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalConsume" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalRefund" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceBefore" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "paymentMethod" TEXT,
    "paymentOrderId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "tradeNo" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "businessType" TEXT NOT NULL,
    "relatedId" TEXT,
    "notifyData" JSONB,
    "notifyTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "walletTransactionId" TEXT,
ADD COLUMN "terminatedAt" TIMESTAMP(3),
ADD COLUMN "terminatedBy" TEXT,
ADD COLUMN "terminatedReason" TEXT,
ADD COLUMN "refundAmount" DECIMAL(10,2),
ADD COLUMN "refundTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_wallets_enterpriseId_key" ON "enterprise_wallets"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_paymentOrderId_key" ON "wallet_transactions"("paymentOrderId");

-- CreateIndex
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_relatedType_relatedId_idx" ON "wallet_transactions"("relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "wallet_transactions_paymentOrderId_idx" ON "wallet_transactions"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_orderNo_key" ON "payment_orders"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_tradeNo_key" ON "payment_orders"("tradeNo");

-- CreateIndex
CREATE INDEX "payment_orders_enterpriseId_createdAt_idx" ON "payment_orders"("enterpriseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "payment_orders_status_createdAt_idx" ON "payment_orders"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_walletTransactionId_key" ON "subscriptions"("walletTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_refundTransactionId_key" ON "subscriptions"("refundTransactionId");

-- AddForeignKey
ALTER TABLE "enterprise_wallets" ADD CONSTRAINT "enterprise_wallets_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "enterprise_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Comment on ComputeAccount.balance deprecation
COMMENT ON COLUMN "compute_accounts"."balance" IS '⚠️ 废弃字段（保留兼容），真实余额从 EnterpriseWallet.balance 读取';
