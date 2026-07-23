-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'CONTRIBUTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CapabilityType" AS ENUM ('AGENT', 'RPA', 'SKILL', 'AI_APP');

-- CreateEnum
CREATE TYPE "CapabilityStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgentPlatform" AS ENUM ('COZE', 'DIFY', 'N8N', 'OPENCODE');

-- CreateEnum
CREATE TYPE "RPAPlatform" AS ENUM ('SHIZAI', 'YINGDAO');

-- CreateEnum
CREATE TYPE "RPAExecutionMode" AS ENUM ('DOWNLOAD', 'CLOUD', 'CLIENT');

-- CreateEnum
CREATE TYPE "AIAppIntegrationMode" AS ENUM ('API', 'IFRAME', 'REDIRECT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('RECHARGE', 'CONSUME', 'REFUND');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "avatar" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_employees" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "avatar" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "modelId" TEXT NOT NULL DEFAULT 'gpt-4o',
    "maxSteps" INTEGER NOT NULL DEFAULT 10,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'DRAFT',
    "price" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "digital_employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "CapabilityType" NOT NULL,
    "industry" TEXT[],
    "position" TEXT[],
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "contributorId" TEXT NOT NULL,
    "status" "CapabilityStatus" NOT NULL DEFAULT 'PENDING',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_configs" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "platform" "AgentPlatform" NOT NULL,
    "botId" TEXT,
    "apiKey" TEXT,
    "workflowUrl" TEXT,
    "skillName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rpa_configs" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "platform" "RPAPlatform" NOT NULL,
    "executionMode" "RPAExecutionMode" NOT NULL,
    "packageUrl" TEXT,
    "packageSha256" TEXT,
    "configDoc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpa_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_configs" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "modelId" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_app_configs" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "integrationMode" "AIAppIntegrationMode" NOT NULL,
    "apiUrl" TEXT,
    "webUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_capability_bindings" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "order" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_capability_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "duration" INTEGER,
    "tokensUsed" INTEGER,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compute_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compute_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compute_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "sessionId" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compute_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_configs_capabilityId_key" ON "agent_configs"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "rpa_configs_capabilityId_key" ON "rpa_configs"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "skill_configs_capabilityId_key" ON "skill_configs"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_app_configs_capabilityId_key" ON "ai_app_configs"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_capability_bindings_employeeId_capabilityId_key" ON "employee_capability_bindings"("employeeId", "capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_employeeId_key" ON "subscriptions"("userId", "employeeId");

-- CreateIndex
CREATE INDEX "messages_sessionId_createdAt_idx" ON "messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_executions_sessionId_createdAt_idx" ON "tool_executions"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "compute_accounts_userId_key" ON "compute_accounts"("userId");

-- CreateIndex
CREATE INDEX "compute_transactions_accountId_createdAt_idx" ON "compute_transactions"("accountId", "createdAt");

-- AddForeignKey
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rpa_configs" ADD CONSTRAINT "rpa_configs_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_configs" ADD CONSTRAINT "skill_configs_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_app_configs" ADD CONSTRAINT "ai_app_configs_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_capability_bindings" ADD CONSTRAINT "employee_capability_bindings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_capability_bindings" ADD CONSTRAINT "employee_capability_bindings_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "conversation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_accounts" ADD CONSTRAINT "compute_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_transactions" ADD CONSTRAINT "compute_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "compute_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
