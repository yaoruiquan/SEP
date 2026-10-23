-- CreateEnum
CREATE TYPE "AccountClosureStatus" AS ENUM ('PREPARING', 'PENDING', 'CANCELLED', 'COMPLETED');

-- AlterEnum
ALTER TYPE "AuthOneTimeTokenType" ADD VALUE 'ACCOUNT_CLOSURE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'CLOSURE_PENDING';
ALTER TYPE "UserStatus" ADD VALUE 'CLOSED';

-- CreateTable
CREATE TABLE "account_closure_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeUserId" TEXT,
    "status" "AccountClosureStatus" NOT NULL DEFAULT 'PREPARING',
    "cancellationTokenHash" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_closure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_closure_requests_activeUserId_key" ON "account_closure_requests"("activeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "account_closure_requests_cancellationTokenHash_key" ON "account_closure_requests"("cancellationTokenHash");

-- CreateIndex
CREATE INDEX "account_closure_requests_status_scheduledFor_idx" ON "account_closure_requests"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "account_closure_requests_userId_createdAt_idx" ON "account_closure_requests"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "account_closure_requests" ADD CONSTRAINT "account_closure_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
