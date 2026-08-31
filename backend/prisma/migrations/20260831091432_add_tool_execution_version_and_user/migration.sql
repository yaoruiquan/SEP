-- AlterTable
ALTER TABLE "enterprise_model_configs" ALTER COLUMN "embeddingModel" SET DEFAULT 'bge-m3:latest';

-- AlterTable
ALTER TABLE "tool_executions" ADD COLUMN     "skillVersionId" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "tool_executions_capabilityId_createdAt_idx" ON "tool_executions"("capabilityId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_executions_skillVersionId_createdAt_idx" ON "tool_executions"("skillVersionId", "createdAt");

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "skill_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
