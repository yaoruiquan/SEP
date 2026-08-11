-- AlterTable
ALTER TABLE "text_chunks" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "embedding" BYTEA,
ADD COLUMN     "embeddingModel" TEXT,
ADD COLUMN     "tokens" TEXT[];

-- CreateIndex
CREATE INDEX "text_chunks_documentId_idx" ON "text_chunks"("documentId");

-- AddForeignKey
ALTER TABLE "text_chunks" ADD CONSTRAINT "text_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
