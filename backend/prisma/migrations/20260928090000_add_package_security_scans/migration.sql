-- CreateEnum
CREATE TYPE "PackageSecurityType" AS ENUM ('SKILL', 'RPA');

-- CreateEnum
CREATE TYPE "PackageSecurityScanStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'QUARANTINED');

-- CreateTable
CREATE TABLE "package_security_scans" (
    "id" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "packageType" "PackageSecurityType" NOT NULL,
    "status" "PackageSecurityScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanner" TEXT NOT NULL,
    "scannerVersion" TEXT NOT NULL,
    "issues" JSONB,
    "warnings" JSONB,
    "scannedAt" TIMESTAMP(3),
    "skillVersionId" TEXT,
    "rpaVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_security_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_security_scans_status_createdAt_idx" ON "package_security_scans"("status", "createdAt");

-- CreateIndex
CREATE INDEX "package_security_scans_skillVersionId_idx" ON "package_security_scans"("skillVersionId");

-- CreateIndex
CREATE INDEX "package_security_scans_rpaVersionId_idx" ON "package_security_scans"("rpaVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "package_security_scans_packageSha256_packageType_key" ON "package_security_scans"("packageSha256", "packageType");

-- AddForeignKey
ALTER TABLE "package_security_scans" ADD CONSTRAINT "package_security_scans_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "skill_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_security_scans" ADD CONSTRAINT "package_security_scans_rpaVersionId_fkey" FOREIGN KEY ("rpaVersionId") REFERENCES "rpa_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
