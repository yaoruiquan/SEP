-- 员工个人技能副本 + 采纳记录
--
-- 会议纪要2 §6.4 明确否掉了「普通员工上传+提审」：员工改自己的副本，改完立刻对他本人
-- 生效，管理员天然可见并可逐条 / 一键采纳。为此需要三样东西：
--   1. SkillVersionScope.PERSONAL + SkillVersion.ownerId —— 「属于谁、对谁生效」
--   2. SkillVersionStatus.PERSONAL_ACTIVE —— 个人副本没有草稿/待审之分，存在即生效
--   3. skill_version_adoptions —— 一键采纳时一个企业版来自多人，是多对多，
--      SkillVersion.sourceVersionId（单值，投稿平台用）表达不了
--
-- 全部为新增，不改动也不删除任何现有数据。PENDING_ENTERPRISE_REVIEW /
-- ENTERPRISE_REJECTED 两个状态保留为历史状态，存量数据仍可读。

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SKILL_VERSION_UPDATED';

-- AlterEnum
ALTER TYPE "SkillVersionScope" ADD VALUE 'PERSONAL';

-- AlterEnum
ALTER TYPE "SkillVersionStatus" ADD VALUE 'PERSONAL_ACTIVE';

-- AlterTable
ALTER TABLE "skill_versions" ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "skill_version_adoptions" (
    "id" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "adoptedById" TEXT NOT NULL,
    "batchId" TEXT,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_version_adoptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_version_adoptions_sourceVersionId_idx" ON "skill_version_adoptions"("sourceVersionId");

-- CreateIndex
CREATE INDEX "skill_version_adoptions_batchId_idx" ON "skill_version_adoptions"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_version_adoptions_targetVersionId_sourceVersionId_key" ON "skill_version_adoptions"("targetVersionId", "sourceVersionId");

-- CreateIndex
CREATE INDEX "skill_versions_ownerId_capabilityId_idx" ON "skill_versions"("ownerId", "capabilityId");

-- AddForeignKey
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version_adoptions" ADD CONSTRAINT "skill_version_adoptions_targetVersionId_fkey" FOREIGN KEY ("targetVersionId") REFERENCES "skill_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version_adoptions" ADD CONSTRAINT "skill_version_adoptions_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "skill_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_version_adoptions" ADD CONSTRAINT "skill_version_adoptions_adoptedById_fkey" FOREIGN KEY ("adoptedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

