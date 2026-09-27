-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('LOCAL_PASSWORD');

-- CreateEnum
CREATE TYPE "AuthOneTimeTokenType" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION', 'EMAIL_CHANGE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "passwordHash" TEXT,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_one_time_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthOneTimeTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_credentials_userId_idx" ON "auth_credentials"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_credentials_userId_type_key" ON "auth_credentials"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_one_time_tokens_tokenHash_key" ON "auth_one_time_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_one_time_tokens_userId_type_consumedAt_idx" ON "auth_one_time_tokens"("userId", "type", "consumedAt");

-- CreateIndex
CREATE INDEX "auth_one_time_tokens_expiresAt_idx" ON "auth_one_time_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_one_time_tokens" ADD CONSTRAINT "auth_one_time_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
