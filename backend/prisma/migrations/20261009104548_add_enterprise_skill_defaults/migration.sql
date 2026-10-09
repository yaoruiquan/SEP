-- AlterTable
ALTER TABLE "skill_versions" ADD COLUMN     "workingCopyId" TEXT,
ADD COLUMN     "workingCopyUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "enterprise_skill_defaults" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_skill_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enterprise_skill_defaults_versionId_idx" ON "enterprise_skill_defaults"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_skill_defaults_enterpriseId_capabilityId_key" ON "enterprise_skill_defaults"("enterpriseId", "capabilityId");

-- CreateIndex
CREATE INDEX "skill_versions_workingCopyId_idx" ON "skill_versions"("workingCopyId");

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_workingCopyId_fkey" FOREIGN KEY ("workingCopyId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_skill_defaults" ADD CONSTRAINT "enterprise_skill_defaults_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_skill_defaults" ADD CONSTRAINT "enterprise_skill_defaults_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_skill_defaults" ADD CONSTRAINT "enterprise_skill_defaults_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_skill_defaults" ADD CONSTRAINT "enterprise_skill_defaults_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
