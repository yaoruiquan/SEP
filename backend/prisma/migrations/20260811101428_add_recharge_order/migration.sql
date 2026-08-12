-- CreateEnum
CREATE TYPE "RechargeOrderStatus" AS ENUM ('PENDING', 'PAID', 'CLOSED');

-- CreateEnum
-- 说明：PayChannel 同时被本迁移与 20260811134914_add_order_and_cart 使用，
-- 而后者时间戳更晚。在全新库上按序重放时本迁移会先执行，故此处幂等创建。
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayChannel') THEN
        CREATE TYPE "PayChannel" AS ENUM ('ALIPAY', 'WECHAT', 'MANUAL');
    END IF;
END
$$;

-- CreateTable
CREATE TABLE "recharge_orders" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RechargeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "payChannel" "PayChannel",
    "payTradeNo" TEXT,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recharge_orders_orderNo_key" ON "recharge_orders"("orderNo");

-- CreateIndex
CREATE INDEX "recharge_orders_accountId_createdAt_idx" ON "recharge_orders"("accountId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "recharge_orders" ADD CONSTRAINT "recharge_orders_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "compute_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
