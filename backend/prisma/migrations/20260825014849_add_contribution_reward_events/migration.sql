-- CreateEnum
CREATE TYPE "ContributionRewardEventType" AS ENUM ('ENTERPRISE_APPROVED', 'PLATFORM_APPROVED', 'ENTERPRISE_ADOPTED', 'MARKET_ADOPTED', 'VALID_USAGE');

-- CreateEnum
CREATE TYPE "ContributionRewardStatus" AS ENUM ('PENDING', 'AVAILABLE', 'SETTLED', 'REVOKED');

-- CreateTable
CREATE TABLE "contribution_reward_events" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "capabilityId" TEXT,
    "versionId" TEXT,
    "eventType" "ContributionRewardEventType" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,6),
    "status" "ContributionRewardStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "contribution_reward_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contribution_reward_events_dedupeKey_key" ON "contribution_reward_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "contribution_reward_events_recipientId_status_createdAt_idx" ON "contribution_reward_events"("recipientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "contribution_reward_events_capabilityId_eventType_idx" ON "contribution_reward_events"("capabilityId", "eventType");

-- AddForeignKey
ALTER TABLE "contribution_reward_events" ADD CONSTRAINT "contribution_reward_events_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_reward_events" ADD CONSTRAINT "contribution_reward_events_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_reward_events" ADD CONSTRAINT "contribution_reward_events_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_reward_events" ADD CONSTRAINT "contribution_reward_events_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
