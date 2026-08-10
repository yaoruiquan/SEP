-- DropForeignKey
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_requesterId_fkey";

-- AlterTable
ALTER TABLE "access_requests" ADD COLUMN     "requesterEmail" TEXT,
ADD COLUMN     "requesterName" TEXT,
ALTER COLUMN "requesterId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "enterprise_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
