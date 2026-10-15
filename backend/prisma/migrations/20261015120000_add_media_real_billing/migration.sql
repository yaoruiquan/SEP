-- CreateTable
CREATE TABLE "media_real_references" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_real_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_real_quotes" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_real_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_real_requests" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "upstreamRequestId" TEXT,
    "scope" TEXT NOT NULL,
    "semanticSha256" TEXT NOT NULL,
    "referenceIds" TEXT[],
    "referenceHashes" TEXT[],
    "count" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "receipt" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "submissionDeadline" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_real_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_real_billing_reservations" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "creditId" TEXT,
    "reservedCny" DECIMAL(14,6) NOT NULL,
    "creditCny" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "memberWalletCny" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "personalCny" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "settledCny" DECIMAL(14,6),
    "settledUsd" DECIMAL(14,6),
    "usdToCnyRate" DECIMAL(10,4) NOT NULL,
    "sourceSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_real_billing_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_real_references_expiresAt_idx" ON "media_real_references"("expiresAt");

-- CreateIndex
CREATE INDEX "media_real_quotes_expiresAt_idx" ON "media_real_quotes"("expiresAt");

-- CreateIndex
CREATE INDEX "media_real_requests_scope_createdAt_idx" ON "media_real_requests"("scope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_real_requests_enterpriseId_clientRequestId_key" ON "media_real_requests"("enterpriseId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "media_real_billing_reservations_receiptId_key" ON "media_real_billing_reservations"("receiptId");

-- CreateIndex
CREATE INDEX "media_real_billing_reservations_enterpriseId_createdAt_idx" ON "media_real_billing_reservations"("enterpriseId", "createdAt" DESC);

