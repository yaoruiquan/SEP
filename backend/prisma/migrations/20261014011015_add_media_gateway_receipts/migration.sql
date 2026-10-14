-- CreateTable
CREATE TABLE "media_gateway_references" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_gateway_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_gateway_quotes" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_gateway_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_gateway_requests" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
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

    CONSTRAINT "media_gateway_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_gateway_references_expiresAt_idx" ON "media_gateway_references"("expiresAt");

-- CreateIndex
CREATE INDEX "media_gateway_quotes_expiresAt_idx" ON "media_gateway_quotes"("expiresAt");

-- CreateIndex
CREATE INDEX "media_gateway_requests_scope_createdAt_idx" ON "media_gateway_requests"("scope", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "media_gateway_requests_enterpriseId_clientRequestId_key" ON "media_gateway_requests"("enterpriseId", "clientRequestId");
