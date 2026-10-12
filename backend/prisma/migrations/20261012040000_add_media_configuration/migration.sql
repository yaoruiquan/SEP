-- AlterTable
ALTER TABLE "enterprise_model_configs" ADD COLUMN     "mediaPolicy" JSONB;

-- CreateTable
CREATE TABLE "media_model_profiles" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "displayName" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "operations" TEXT[] DEFAULT ARRAY['generate']::TEXT[],
    "executionMode" TEXT NOT NULL DEFAULT 'sync-response',
    "capabilities" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_model_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_model_profiles_profileId_key" ON "media_model_profiles"("profileId");

-- CreateIndex
CREATE INDEX "media_model_profiles_kind_enabled_verified_idx" ON "media_model_profiles"("kind", "enabled", "verified");
