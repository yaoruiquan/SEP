/*
  Warnings:

  - You are about to drop the column `actionUrl` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `category` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the column `severity` on the `notifications` table. All the data in the column will be lost.
  - You are about to drop the `notification_preferences` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- DropForeignKey
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_userId_fkey";

-- DropIndex
DROP INDEX "notifications_userId_category_idx";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "actionUrl",
DROP COLUMN "category",
DROP COLUMN "severity";

-- DropTable
DROP TABLE "notification_preferences";

-- CreateTable
CREATE TABLE "enterprise_invitations" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "EnterpriseRole" NOT NULL DEFAULT 'MEMBER',
    "departmentId" TEXT,
    "position" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "enterprise_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_invitations_tokenHash_key" ON "enterprise_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "enterprise_invitations_enterpriseId_email_idx" ON "enterprise_invitations"("enterpriseId", "email");

-- CreateIndex
CREATE INDEX "enterprise_invitations_enterpriseId_status_idx" ON "enterprise_invitations"("enterpriseId", "status");

-- AddForeignKey
ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_invitations" ADD CONSTRAINT "enterprise_invitations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "enterprise_api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
