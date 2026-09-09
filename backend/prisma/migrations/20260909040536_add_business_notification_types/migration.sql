-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_ENTERPRISE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_ENTERPRISE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_PLATFORM_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_PLATFORM_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'CONTRIBUTION_REWARD_CREDITED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRING';
