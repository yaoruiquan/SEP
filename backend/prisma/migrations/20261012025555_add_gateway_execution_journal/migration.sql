-- CreateEnum
CREATE TYPE "GatewayExecutionStatus" AS ENUM ('STARTED', 'USAGE_PENDING', 'SETTLED', 'NEEDS_RECONCILIATION', 'FAILED');

-- CreateTable
CREATE TABLE "gateway_executions" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "upstreamRequestId" TEXT,
    "status" "GatewayExecutionStatus" NOT NULL DEFAULT 'STARTED',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "finishReason" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "settlementAttempts" INTEGER NOT NULL DEFAULT 0,
    "settlementReady" BOOLEAN NOT NULL DEFAULT false,
    "settlementLeaseUntil" TIMESTAMP(3),
    "usageRecordId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gateway_executions_status_settlementLeaseUntil_createdAt_idx" ON "gateway_executions"("status", "settlementLeaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_executions_status_expiresAt_idx" ON "gateway_executions"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "gateway_executions_enterpriseId_createdAt_idx" ON "gateway_executions"("enterpriseId", "createdAt");

-- CreateIndex
CREATE INDEX "gateway_executions_requestId_idx" ON "gateway_executions"("requestId");
