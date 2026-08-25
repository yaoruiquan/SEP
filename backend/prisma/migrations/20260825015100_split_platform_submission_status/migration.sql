-- Preserve existing platform review values while separating the creator request
-- from the administrator-authorized platform review queue.
CREATE TYPE "ContributionPlatformStatus" AS ENUM ('NOT_SUBMITTED', 'REQUESTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TABLE "capabilities"
  ADD COLUMN "platformReviewStatus_new" "ContributionPlatformStatus" NOT NULL DEFAULT 'NOT_SUBMITTED';

UPDATE "capabilities"
SET "platformReviewStatus_new" = CASE "platformReviewStatus"::text
  WHEN 'PENDING' THEN 'REQUESTED'::"ContributionPlatformStatus"
  WHEN 'APPROVED' THEN 'APPROVED'::"ContributionPlatformStatus"
  WHEN 'REJECTED' THEN 'REJECTED'::"ContributionPlatformStatus"
  ELSE 'NOT_SUBMITTED'::"ContributionPlatformStatus"
END;

ALTER TABLE "capabilities" DROP COLUMN "platformReviewStatus";
ALTER TABLE "capabilities" RENAME COLUMN "platformReviewStatus_new" TO "platformReviewStatus";

CREATE INDEX "capabilities_visibility_platformReviewStatus_idx"
  ON "capabilities"("visibility", "platformReviewStatus");
