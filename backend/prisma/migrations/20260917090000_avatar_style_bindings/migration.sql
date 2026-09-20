-- AlterTable
ALTER TABLE "digital_employees" ADD COLUMN     "avatarBindings" JSONB,
ADD COLUMN     "avatarCustomUrl" TEXT;

-- CreateTable
CREATE TABLE "avatar_style_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'platform',
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "examples" JSONB,
    "totalAssets" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "avatar_style_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avatar_style_definitions_active_source_idx" ON "avatar_style_definitions"("active", "source");

