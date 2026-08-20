-- CreateEnum
CREATE TYPE "SkillVersionScope" AS ENUM ('PLATFORM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SkillVersionStatus" AS ENUM ('DRAFT', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'PENDING_PLATFORM_REVIEW', 'PLATFORM_APPROVED', 'ENTERPRISE_REJECTED', 'PLATFORM_REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkillReviewActorType" AS ENUM ('ENTERPRISE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "SkillReviewDecision" AS ENUM ('APPROVE', 'REJECT');

-- AlterTable
ALTER TABLE "employee_capability_bindings" ADD COLUMN     "defaultSkillVersionId" TEXT;

-- CreateTable
CREATE TABLE "skill_versions" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "scope" "SkillVersionScope" NOT NULL,
    "enterpriseId" TEXT,
    "parentVersionId" TEXT,
    "sourceVersionId" TEXT,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "changeSummary" TEXT,
    "status" "SkillVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "enterpriseReviewedById" TEXT,
    "enterpriseReviewedAt" TIMESTAMP(3),
    "platformReviewedById" TEXT,
    "platformReviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_version_reviews" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "actorType" "SkillReviewActorType" NOT NULL,
    "decision" "SkillReviewDecision" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_version_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_skill_versions" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_versions_sourceVersionId_key" ON "skill_versions"("sourceVersionId");

-- CreateIndex
CREATE INDEX "skill_versions_capabilityId_status_idx" ON "skill_versions"("capabilityId", "status");

-- CreateIndex
CREATE INDEX "skill_versions_enterpriseId_status_idx" ON "skill_versions"("enterpriseId", "status");

-- CreateIndex
CREATE INDEX "skill_versions_parentVersionId_idx" ON "skill_versions"("parentVersionId");

-- 同一技能的版本号在各作用域内唯一。PostgreSQL 的普通 UNIQUE 会把 NULL
-- 视为互不相等，因此平台版本和企业版本分别使用部分唯一索引。
CREATE UNIQUE INDEX "skill_versions_platform_version_key"
ON "skill_versions"("capabilityId", "version")
WHERE "scope" = 'PLATFORM';

CREATE UNIQUE INDEX "skill_versions_enterprise_version_key"
ON "skill_versions"("capabilityId", "enterpriseId", "version")
WHERE "scope" = 'ENTERPRISE';

-- CreateIndex
CREATE INDEX "skill_version_reviews_versionId_createdAt_idx" ON "skill_version_reviews"("versionId", "createdAt");

-- CreateIndex
CREATE INDEX "subscription_skill_versions_subscriptionId_idx" ON "subscription_skill_versions"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_skill_versions_versionId_idx" ON "subscription_skill_versions"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_skill_versions_subscriptionId_capabilityId_key" ON "subscription_skill_versions"("subscriptionId", "capabilityId");

-- CreateIndex
CREATE INDEX "employee_capability_bindings_defaultSkillVersionId_idx" ON "employee_capability_bindings"("defaultSkillVersionId");

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_enterpriseReviewedById_fkey" FOREIGN KEY ("enterpriseReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_platformReviewedById_fkey" FOREIGN KEY ("platformReviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version_reviews" ADD CONSTRAINT "skill_version_reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version_reviews" ADD CONSTRAINT "skill_version_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_capability_bindings" ADD CONSTRAINT "employee_capability_bindings_defaultSkillVersionId_fkey" FOREIGN KEY ("defaultSkillVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_skill_versions" ADD CONSTRAINT "subscription_skill_versions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_skill_versions" ADD CONSTRAINT "subscription_skill_versions_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_skill_versions" ADD CONSTRAINT "subscription_skill_versions_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "skill_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_skill_versions" ADD CONSTRAINT "subscription_skill_versions_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 作用域与企业归属必须一致，避免平台版本意外挂企业或企业版本失去租户边界。
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_scope_enterprise_check"
CHECK (
  ("scope" = 'PLATFORM' AND "enterpriseId" IS NULL)
  OR ("scope" = 'ENTERPRISE' AND "enterpriseId" IS NOT NULL)
);

-- 从现有 SkillConfig 创建不可变的初始平台版本。保留 skill_configs.template
-- 作为兼容与回滚数据源；content 仅剥离文件开头的 YAML frontmatter。
INSERT INTO "skill_versions" (
  "id",
  "capabilityId",
  "scope",
  "version",
  "content",
  "changeSummary",
  "status",
  "createdById",
  "submittedAt",
  "platformReviewedById",
  "platformReviewedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'sv_' || md5(c.id || ':initial'),
  c.id,
  'PLATFORM'::"SkillVersionScope",
  '1.0.0',
  regexp_replace(
    sc.template,
    E'^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n',
    ''
  ),
  '从现有技能配置迁移的初始版本',
  CASE
    WHEN c.status = 'APPROVED' THEN 'PLATFORM_APPROVED'::"SkillVersionStatus"
    ELSE 'DRAFT'::"SkillVersionStatus"
  END,
  c."contributorId",
  CASE WHEN c.status = 'APPROVED' THEN COALESCE(c."approvedAt", c."createdAt") ELSE NULL END,
  NULL,
  CASE WHEN c.status = 'APPROVED' THEN COALESCE(c."approvedAt", c."createdAt") ELSE NULL END,
  sc."createdAt",
  sc."updatedAt"
FROM "capabilities" c
INNER JOIN "skill_configs" sc ON sc."capabilityId" = c.id
WHERE c.type = 'SKILL';

-- 平台模板的员工技能绑定默认沿用刚迁移出的初始版本。
UPDATE "employee_capability_bindings" ecb
SET "defaultSkillVersionId" = sv.id
FROM "skill_versions" sv
WHERE sv."capabilityId" = ecb."capabilityId"
  AND sv.scope = 'PLATFORM'
  AND sv.version = '1.0.0';
