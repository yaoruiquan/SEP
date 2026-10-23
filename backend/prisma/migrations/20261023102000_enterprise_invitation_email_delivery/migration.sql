-- CreateEnum
CREATE TYPE "InvitationEmailStatus" AS ENUM ('UNKNOWN', 'SENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED');

-- AlterTable
ALTER TABLE "enterprise_invitations" ADD COLUMN     "emailError" TEXT,
ADD COLUMN     "emailLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "emailStatus" "InvitationEmailStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "updatedAt" TIMESTAMP(3);

UPDATE "enterprise_invitations" SET "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "enterprise_invitations" ALTER COLUMN "updatedAt" SET NOT NULL;
