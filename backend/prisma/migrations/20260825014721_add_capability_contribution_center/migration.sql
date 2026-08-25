-- CreateEnum
CREATE TYPE "CapabilityVisibility" AS ENUM ('ENTERPRISE_PRIVATE', 'MARKET_PUBLIC');

-- CreateEnum
CREATE TYPE "ContributionReviewStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "digital_employees_functionalCategory_idx";

-- AlterTable
ALTER TABLE "capabilities" ADD COLUMN     "enterpriseId" TEXT,
ADD COLUMN     "enterpriseRejectionReason" TEXT,
ADD COLUMN     "enterpriseReviewStatus" "ContributionReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "enterpriseReviewedAt" TIMESTAMP(3),
ADD COLUMN     "enterpriseReviewedById" TEXT,
ADD COLUMN     "platformRejectionReason" TEXT,
ADD COLUMN     "platformReviewStatus" "ContributionReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "platformSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "platformSubmittedById" TEXT,
ADD COLUMN     "visibility" "CapabilityVisibility" NOT NULL DEFAULT 'ENTERPRISE_PRIVATE';

-- CreateIndex
CREATE INDEX "capabilities_enterpriseId_enterpriseReviewStatus_idx" ON "capabilities"("enterpriseId", "enterpriseReviewStatus");

-- CreateIndex
CREATE INDEX "capabilities_visibility_platformReviewStatus_idx" ON "capabilities"("visibility", "platformReviewStatus");

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_enterpriseReviewedById_fkey" FOREIGN KEY ("enterpriseReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_platformSubmittedById_fkey" FOREIGN KEY ("platformSubmittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
