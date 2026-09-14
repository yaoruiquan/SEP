-- CreateTable
CREATE TABLE "client_task_mirrors" (
    "id" TEXT NOT NULL,
    "clientTaskId" TEXT NOT NULL,
    "clientRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enterpriseId" TEXT,
    "subscriptionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taskType" TEXT NOT NULL DEFAULT 'conversation',
    "modelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "activity" TEXT,
    "errorSummary" TEXT,
    "clientVersion" TEXT,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_task_mirrors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_task_mirror_events" (
    "id" TEXT NOT NULL,
    "mirrorId" TEXT NOT NULL,
    "clientRunId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "stepKey" TEXT,
    "message" TEXT,
    "progress" INTEGER,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_task_mirror_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_task_mirrors_enterpriseId_status_updatedAt_idx" ON "client_task_mirrors"("enterpriseId", "status", "updatedAt");
CREATE INDEX "client_task_mirrors_subscriptionId_updatedAt_idx" ON "client_task_mirrors"("subscriptionId", "updatedAt");
CREATE UNIQUE INDEX "client_task_mirrors_userId_clientTaskId_key" ON "client_task_mirrors"("userId", "clientTaskId");
CREATE INDEX "client_task_mirror_events_mirrorId_createdAt_idx" ON "client_task_mirror_events"("mirrorId", "createdAt");
CREATE UNIQUE INDEX "client_task_mirror_events_mirrorId_clientRunId_sequence_key" ON "client_task_mirror_events"("mirrorId", "clientRunId", "sequence");

-- AddForeignKey
ALTER TABLE "client_task_mirrors" ADD CONSTRAINT "client_task_mirrors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_task_mirrors" ADD CONSTRAINT "client_task_mirrors_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_task_mirrors" ADD CONSTRAINT "client_task_mirrors_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_task_mirror_events" ADD CONSTRAINT "client_task_mirror_events_mirrorId_fkey" FOREIGN KEY ("mirrorId") REFERENCES "client_task_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
