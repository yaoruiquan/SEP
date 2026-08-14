-- CreateTable
CREATE TABLE "subscription_requests" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "requesterId" TEXT,
    "requesterEmail" TEXT,
    "requesterName" TEXT,
    "employeeId" TEXT NOT NULL,
    "reason" TEXT,
    "requestedDays" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "subscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscription_requests_enterpriseId_idx" ON "subscription_requests"("enterpriseId");

-- CreateIndex
CREATE INDEX "subscription_requests_requesterId_idx" ON "subscription_requests"("requesterId");

-- CreateIndex
CREATE INDEX "subscription_requests_employeeId_idx" ON "subscription_requests"("employeeId");

-- CreateIndex
CREATE INDEX "subscription_requests_status_idx" ON "subscription_requests"("status");

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "enterprise_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_requests" ADD CONSTRAINT "subscription_requests_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
