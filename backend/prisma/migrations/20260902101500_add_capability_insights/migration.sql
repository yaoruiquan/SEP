-- 智能沉淀建议（会议纪要2 §6.5 / 行动项 5）
--
-- 建议由 LLM 从「执行记录 + 成员个人副本」里提取，永不自动生效：
-- 采纳走 adoptInsight 生成新企业版本，由管理员显式点下去。
-- sampleSize / personalCount 记「这次看了多少材料」—— 没有它，
-- 「建议靠不靠谱」无从判断。

-- CreateEnum
CREATE TYPE "CAPABILITY_INSIGHT_SCOPE" AS ENUM ('MEMBER', 'ALL');

-- CreateEnum
CREATE TYPE "CAPABILITY_INSIGHT_STATUS" AS ENUM ('PENDING', 'ADOPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "capability_insights" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "scope" "CAPABILITY_INSIGHT_SCOPE" NOT NULL,
    "memberId" TEXT,
    "findings" JSONB NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "personalCount" INTEGER NOT NULL DEFAULT 0,
    "modelId" TEXT NOT NULL,
    "status" "CAPABILITY_INSIGHT_STATUS" NOT NULL DEFAULT 'PENDING',
    "adoptedVersionId" TEXT,
    "adoptedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capability_insights_capabilityId_status_idx" ON "capability_insights"("capabilityId", "status");

-- CreateIndex
CREATE INDEX "capability_insights_enterpriseId_createdAt_idx" ON "capability_insights"("enterpriseId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "capability_insights" ADD CONSTRAINT "capability_insights_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_insights" ADD CONSTRAINT "capability_insights_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_insights" ADD CONSTRAINT "capability_insights_adoptedById_fkey" FOREIGN KEY ("adoptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_insights" ADD CONSTRAINT "capability_insights_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

