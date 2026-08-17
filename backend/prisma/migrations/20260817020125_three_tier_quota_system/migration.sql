-- AlterTable
ALTER TABLE "compute_quotas" ALTER COLUMN "priority" SET DEFAULT 2;

-- AlterTable
ALTER TABLE "compute_transactions" ADD COLUMN     "quotaTier" TEXT,
ADD COLUMN     "quotaType" TEXT,
ADD COLUMN     "subscriptionQuotaId" TEXT,
ADD COLUMN     "userQuotaId" TEXT;

-- CreateTable
CREATE TABLE "user_quotas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "usedTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_quotas" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "usedTokens" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_quotas_userId_idx" ON "user_quotas"("userId");

-- CreateIndex
CREATE INDEX "user_quotas_enterpriseId_status_idx" ON "user_quotas"("enterpriseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_quotas_userId_enterpriseId_key" ON "user_quotas"("userId", "enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_quotas_subscriptionId_key" ON "subscription_quotas"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_quotas_subscriptionId_idx" ON "subscription_quotas"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_quotas_enterpriseId_status_idx" ON "subscription_quotas"("enterpriseId", "status");

-- CreateIndex
CREATE INDEX "compute_transactions_userQuotaId_idx" ON "compute_transactions"("userQuotaId");

-- CreateIndex
CREATE INDEX "compute_transactions_subscriptionQuotaId_idx" ON "compute_transactions"("subscriptionQuotaId");

-- AddForeignKey
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_allocatedBy_fkey" FOREIGN KEY ("allocatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "subscription_quotas_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_quotas" ADD CONSTRAINT "subscription_quotas_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_transactions" ADD CONSTRAINT "compute_transactions_userQuotaId_fkey" FOREIGN KEY ("userQuotaId") REFERENCES "user_quotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_transactions" ADD CONSTRAINT "compute_transactions_subscriptionQuotaId_fkey" FOREIGN KEY ("subscriptionQuotaId") REFERENCES "subscription_quotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
