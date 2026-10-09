-- CreateTable
CREATE TABLE "member_skill_version_selections" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_skill_version_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_skill_version_selections_subscriptionId_capabilityId_idx" ON "member_skill_version_selections"("subscriptionId", "capabilityId");

-- CreateIndex
CREATE INDEX "member_skill_version_selections_versionId_idx" ON "member_skill_version_selections"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "member_skill_version_selections_memberId_subscriptionId_cap_key" ON "member_skill_version_selections"("memberId", "subscriptionId", "capabilityId");

-- AddForeignKey
ALTER TABLE "member_skill_version_selections" ADD CONSTRAINT "member_skill_version_selections_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "enterprise_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_skill_version_selections" ADD CONSTRAINT "member_skill_version_selections_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_skill_version_selections" ADD CONSTRAINT "member_skill_version_selections_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_skill_version_selections" ADD CONSTRAINT "member_skill_version_selections_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
