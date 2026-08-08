-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- AlterEnum
ALTER TYPE "DocumentStatus" ADD VALUE 'PROCESSING';

-- AlterEnum
BEGIN;
CREATE TYPE "EmployeeStatus_new" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');
ALTER TABLE "public"."digital_employees" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "digital_employees" ALTER COLUMN "status" TYPE "EmployeeStatus_new" USING ("status"::text::"EmployeeStatus_new");
ALTER TYPE "EmployeeStatus" RENAME TO "EmployeeStatus_old";
ALTER TYPE "EmployeeStatus_new" RENAME TO "EmployeeStatus";
DROP TYPE "public"."EmployeeStatus_old";
ALTER TABLE "digital_employees" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN     "region" TEXT,
ADD COLUMN     "runtimeKind" TEXT,
ADD COLUMN     "webUrl" TEXT,
ADD COLUMN     "workflowId" TEXT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "leader_id" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "employee_capability_bindings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "cost" DECIMAL(10,6),
ADD COLUMN     "knowledgeSources" JSONB,
ADD COLUMN     "modelId" TEXT;

-- AlterTable
ALTER TABLE "platform_models" ADD COLUMN     "category" TEXT,
ADD COLUMN     "contextLength" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "maxOutputTokens" INTEGER,
ADD COLUMN     "pricingInputPer1M" DECIMAL(10,4),
ADD COLUMN     "pricingOutputPer1M" DECIMAL(10,4),
ADD COLUMN     "supportedFeatures" JSONB,
ADD COLUMN     "vendor" TEXT;

-- CreateTable
CREATE TABLE "knowledge_search_logs" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "topK" INTEGER NOT NULL,
    "hitCount" INTEGER NOT NULL,
    "topScore" DOUBLE PRECISION,
    "strategy" TEXT NOT NULL DEFAULT 'vector',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_chunks" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "tags" TEXT[],
    "vectorId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "text_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_usage_logs" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "retrievedChunks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_model_configs" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "defaultChatModel" TEXT NOT NULL DEFAULT 'gemini-3.5-flash-high',
    "allowedChatModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowUserSwitchModel" BOOLEAN NOT NULL DEFAULT true,
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "rerankModel" TEXT,
    "embeddingBatchSize" INTEGER NOT NULL DEFAULT 32,
    "embeddingTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "employeeModelPolicy" TEXT NOT NULL DEFAULT 'FOLLOW_TEMPLATE',
    "employeeDefaultModel" TEXT,
    "monthlyBudgetCNY" DECIMAL(12,2),
    "alertThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "hardStopOnBudget" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_daily_rollups" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "departmentId" TEXT,
    "employeeInstanceId" TEXT,
    "modelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costCNY" DECIMAL(12,4) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_model_policies" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "defaultChatModel" TEXT,
    "allowedChatModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_model_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_search_logs_knowledgeBaseId_createdAt_idx" ON "knowledge_search_logs"("knowledgeBaseId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_search_logs_enterpriseId_createdAt_idx" ON "knowledge_search_logs"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "text_chunks_knowledgeBaseId_idx" ON "text_chunks"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "knowledge_usage_logs_knowledgeBaseId_idx" ON "knowledge_usage_logs"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "knowledge_usage_logs_sessionId_idx" ON "knowledge_usage_logs"("sessionId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_model_configs_enterpriseId_key" ON "enterprise_model_configs"("enterpriseId");

-- CreateIndex
CREATE INDEX "cost_daily_rollups_enterpriseId_date_idx" ON "cost_daily_rollups"("enterpriseId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cost_daily_rollups_enterpriseId_departmentId_employeeInstan_key" ON "cost_daily_rollups"("enterpriseId", "departmentId", "employeeInstanceId", "modelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "department_model_policies_departmentId_key" ON "department_model_policies"("departmentId");

-- CreateIndex
CREATE INDEX "documents_knowledgeBaseId_status_idx" ON "documents"("knowledgeBaseId", "status");

-- CreateIndex
CREATE INDEX "employee_capability_bindings_employeeId_idx" ON "employee_capability_bindings"("employeeId");

-- CreateIndex
CREATE INDEX "employee_capability_bindings_capabilityId_idx" ON "employee_capability_bindings"("capabilityId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "enterprise_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_chunks" ADD CONSTRAINT "text_chunks_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_chunks" ADD CONSTRAINT "text_chunks_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_usage_logs" ADD CONSTRAINT "knowledge_usage_logs_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_usage_logs" ADD CONSTRAINT "knowledge_usage_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_model_configs" ADD CONSTRAINT "enterprise_model_configs_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_model_policies" ADD CONSTRAINT "department_model_policies_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

