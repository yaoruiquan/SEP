-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CLOSED', 'REFUNDED');

-- CreateEnum
-- 幂等：20260811101428_add_recharge_order 可能已创建该类型（见该迁移注释）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayChannel') THEN
        CREATE TYPE "PayChannel" AS ENUM ('ALIPAY', 'WECHAT', 'MANUAL');
    END IF;
END
$$;

-- AlterTable
ALTER TABLE "digital_employees" ADD COLUMN "annualPriceCNY" DECIMAL(12,2),
ADD COLUMN "includedComputeCNY" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "payChannel" "PayChannel",
    "payTradeNo" TEXT,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "includedComputeCNY" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifies" (
    "id" TEXT NOT NULL,
    "channel" "PayChannel" NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "tradeNo" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNo_key" ON "orders"("orderNo");

-- CreateIndex
CREATE INDEX "orders_enterpriseId_createdAt_idx" ON "orders"("enterpriseId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_enterpriseId_employeeId_key" ON "cart_items"("enterpriseId", "employeeId");

-- CreateIndex
CREATE INDEX "cart_items_enterpriseId_idx" ON "cart_items"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifies_channel_tradeNo_key" ON "payment_notifies"("channel", "tradeNo");

-- CreateIndex
CREATE INDEX "payment_notifies_outTradeNo_idx" ON "payment_notifies"("outTradeNo");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
