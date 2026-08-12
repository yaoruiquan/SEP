-- CreateEnum
CREATE TYPE "RechargeOrderStatus" AS ENUM ('PENDING', 'PAID', 'CLOSED');

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
