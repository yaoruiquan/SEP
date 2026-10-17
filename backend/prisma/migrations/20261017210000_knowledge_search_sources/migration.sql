-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "text_chunks" ADD COLUMN     "blockEnd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "blockStart" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pageEnd" INTEGER,
ADD COLUMN     "pageStart" INTEGER,
ADD COLUMN     "sectionPath" TEXT[] DEFAULT ARRAY[]::TEXT[];
