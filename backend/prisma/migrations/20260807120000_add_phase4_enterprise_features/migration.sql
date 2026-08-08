-- Phase 4: Enterprise Settings · Custom Roles · API Keys
-- These tables were applied directly to the database; this file records the schema for history.

-- CreateTable enterprise_model_configs
CREATE TABLE IF NOT EXISTS "enterprise_model_configs" (
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

-- CreateTable enterprise_settings
CREATE TABLE IF NOT EXISTS "enterprise_settings" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "sensitiveWordsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sensitiveWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 480,
    "forcePasswordRotationDays" INTEGER,
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "enterprise_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable custom_roles
CREATE TABLE IF NOT EXISTS "custom_roles" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable enterprise_api_keys
CREATE TABLE IF NOT EXISTS "enterprise_api_keys" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "enterprise_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable api_call_logs
CREATE TABLE IF NOT EXISTS "api_call_logs" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_call_logs_pkey" PRIMARY KEY ("id")
);

-- AlterTable enterprise_members: add customRoleId
ALTER TABLE "enterprise_members" ADD COLUMN IF NOT EXISTS "customRoleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_model_configs_enterpriseId_key" ON "enterprise_model_configs"("enterpriseId");
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_settings_enterpriseId_key" ON "enterprise_settings"("enterpriseId");
CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_enterpriseId_name_key" ON "custom_roles"("enterpriseId", "name");
CREATE INDEX IF NOT EXISTS "enterprise_api_keys_enterpriseId_idx" ON "enterprise_api_keys"("enterpriseId");
CREATE INDEX IF NOT EXISTS "api_call_logs_enterpriseId_createdAt_idx" ON "api_call_logs"("enterpriseId", "createdAt");

-- AddForeignKey
ALTER TABLE "enterprise_model_configs" ADD CONSTRAINT "enterprise_model_configs_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_settings" ADD CONSTRAINT "enterprise_settings_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_api_keys" ADD CONSTRAINT "enterprise_api_keys_enterpriseId_fkey"
  FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
