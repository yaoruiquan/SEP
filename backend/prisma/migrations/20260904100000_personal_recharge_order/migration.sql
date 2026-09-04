-- CreateTable
CREATE TABLE "personal_recharge_orders" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "RechargeOrderStatus" NOT NULL DEFAULT 'PENDING',
    "payChannel" "PayChannel",
    "payTradeNo" TEXT,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_recharge_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_recharge_orders_orderNo_key" ON "personal_recharge_orders"("orderNo");

-- CreateIndex
CREATE INDEX "personal_recharge_orders_userId_createdAt_idx" ON "personal_recharge_orders"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "personal_recharge_orders" ADD CONSTRAINT "personal_recharge_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

