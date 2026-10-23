-- CreateEnum
CREATE TYPE "EnterpriseStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- AlterTable
ALTER TABLE "enterprises" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "status" "EnterpriseStatus" NOT NULL DEFAULT 'ACTIVE';
