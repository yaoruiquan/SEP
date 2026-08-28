-- AlterTable
ALTER TABLE "skill_versions" ADD COLUMN     "packageFileCount" INTEGER,
ADD COLUMN     "packageFilename" TEXT,
ADD COLUMN     "packageKey" TEXT,
ADD COLUMN     "packageSha256" TEXT;
