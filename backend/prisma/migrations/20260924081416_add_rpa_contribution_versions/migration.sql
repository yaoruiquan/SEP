-- CreateEnum
CREATE TYPE "RpaVersionStatus" AS ENUM ('DRAFT', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED', 'PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED', 'PLATFORM_REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "rpa_versions" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "packageFilename" TEXT,
    "packageFileCount" INTEGER NOT NULL,
    "packageBytes" INTEGER NOT NULL,
    "configDoc" TEXT NOT NULL,
    "status" "RpaVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "validationResult" JSONB,
    "validatedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rpa_versions_capabilityId_status_idx" ON "rpa_versions"("capabilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rpa_versions_capabilityId_version_key" ON "rpa_versions"("capabilityId", "version");

-- AddForeignKey
ALTER TABLE "rpa_versions" ADD CONSTRAINT "rpa_versions_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rpa_versions" ADD CONSTRAINT "rpa_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
