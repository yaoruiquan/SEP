-- CreateEnum
CREATE TYPE "OAuthTransactionIntent" AS ENUM ('LOGIN', 'LINK', 'INVITATION');

-- CreateTable
CREATE TABLE "auth_oauth_transactions" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "intent" "OAuthTransactionIntent" NOT NULL DEFAULT 'LOGIN',
    "stateHash" TEXT NOT NULL,
    "nonceHash" TEXT,
    "redirectUri" TEXT NOT NULL,
    "userId" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_oauth_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "profile" JSONB,
    "emailVerified" BOOLEAN,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_oauth_transactions_stateHash_key" ON "auth_oauth_transactions"("stateHash");

-- CreateIndex
CREATE INDEX "auth_oauth_transactions_provider_expiresAt_idx" ON "auth_oauth_transactions"("provider", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_oauth_transactions_userId_intent_consumedAt_idx" ON "auth_oauth_transactions"("userId", "intent", "consumedAt");

-- CreateIndex
CREATE INDEX "auth_identities_provider_providerEmail_idx" ON "auth_identities"("provider", "providerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_providerAccountId_key" ON "auth_identities"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_userId_provider_key" ON "auth_identities"("userId", "provider");

-- AddForeignKey
ALTER TABLE "auth_oauth_transactions" ADD CONSTRAINT "auth_oauth_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
