-- AlterTable
ALTER TABLE "compute_transactions" ADD COLUMN     "quotaId" TEXT,
ADD COLUMN     "tokens" INTEGER;

-- CreateTable
CREATE TABLE "compute_quotas" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "usedTokens" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compute_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compute_quotas_enterpriseId_status_idx" ON "compute_quotas"("enterpriseId", "status");

-- CreateIndex
CREATE INDEX "compute_transactions_quotaId_idx" ON "compute_transactions"("quotaId");

-- AddForeignKey
ALTER TABLE "compute_quotas" ADD CONSTRAINT "compute_quotas_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_transactions" ADD CONSTRAINT "compute_transactions_quotaId_fkey" FOREIGN KEY ("quotaId") REFERENCES "compute_quotas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
