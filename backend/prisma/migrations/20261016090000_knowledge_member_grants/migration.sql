-- AlterTable
ALTER TABLE "knowledge_bases" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "knowledge_member_grants" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "grantedByMemberId" TEXT,
    "grantedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_member_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_member_grants_knowledgeBaseId_createdAt_idx" ON "knowledge_member_grants"("knowledgeBaseId", "createdAt");

-- CreateIndex
CREATE INDEX "knowledge_member_grants_grantedByMemberId_idx" ON "knowledge_member_grants"("grantedByMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_member_grants_memberId_knowledgeBaseId_key" ON "knowledge_member_grants"("memberId", "knowledgeBaseId");

-- AddForeignKey
ALTER TABLE "knowledge_member_grants" ADD CONSTRAINT "knowledge_member_grants_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_member_grants" ADD CONSTRAINT "knowledge_member_grants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "enterprise_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_member_grants" ADD CONSTRAINT "knowledge_member_grants_grantedByMemberId_fkey" FOREIGN KEY ("grantedByMemberId") REFERENCES "enterprise_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
