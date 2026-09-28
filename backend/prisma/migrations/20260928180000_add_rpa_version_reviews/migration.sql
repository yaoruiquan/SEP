-- CreateTable
CREATE TABLE "rpa_version_reviews" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actorType" "SkillReviewActorType" NOT NULL,
    "decision" "SkillReviewDecision" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "packageVersion" TEXT NOT NULL,
    "packageSha256" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpa_version_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rpa_version_reviews_versionId_createdAt_idx" ON "rpa_version_reviews"("versionId", "createdAt");

-- AddForeignKey
ALTER TABLE "rpa_version_reviews" ADD CONSTRAINT "rpa_version_reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "rpa_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rpa_version_reviews" ADD CONSTRAINT "rpa_version_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill legacy RPA package configuration into the version model. Existing
-- RPA configs represent the original package, so preserve it as version 1.0.0.
INSERT INTO "rpa_versions" (
    "id", "capabilityId", "version", "packageKey", "packageSha256",
    "packageFilename", "packageFileCount", "packageBytes", "configDoc",
    "status", "createdById", "createdAt", "updatedAt"
)
SELECT
    'rpa_legacy_' || r.id,
    r."capabilityId",
    '1.0.0',
    'rpa/' || r."packageSha256" || '.zip',
    r."packageSha256",
    NULL,
    0,
    0,
    COALESCE(r."configDoc", ''),
    CASE
      WHEN c."visibility" = 'MARKET_PUBLIC' AND c."platformReviewStatus" = 'APPROVED'
        THEN 'PLATFORM_APPROVED'::"RpaVersionStatus"
      WHEN c."enterpriseReviewStatus" = 'APPROVED'
        THEN 'ENTERPRISE_APPROVED'::"RpaVersionStatus"
      ELSE 'DRAFT'::"RpaVersionStatus"
    END,
    c."contributorId",
    r."createdAt",
    r."updatedAt"
FROM "rpa_configs" r
JOIN "capabilities" c ON c.id = r."capabilityId"
WHERE r."packageSha256" IS NOT NULL
  AND r."packageSha256" ~ '^[0-9a-f]{64}$'
ON CONFLICT ("capabilityId", "version") DO NOTHING;
