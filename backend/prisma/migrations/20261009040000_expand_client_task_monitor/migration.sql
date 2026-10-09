-- AlterTable
ALTER TABLE "client_task_mirrors" ADD COLUMN     "protocolVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "queuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "client_task_mirror_events" ADD COLUMN     "participationId" TEXT,
ADD COLUMN     "participationMetadata" JSONB;

-- CreateTable
CREATE TABLE "client_task_mirror_runs" (
    "id" TEXT NOT NULL,
    "mirrorId" TEXT NOT NULL,
    "clientRunId" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "subscriptionName" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "modelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_task_mirror_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_task_participations" (
    "id" TEXT NOT NULL,
    "mirrorId" TEXT NOT NULL,
    "clientRunId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "subscriptionName" TEXT NOT NULL,
    "nodeId" TEXT,
    "title" TEXT,
    "modelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_task_participations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_task_mirror_runs_subscriptionId_queuedAt_idx" ON "client_task_mirror_runs"("subscriptionId", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_task_mirror_runs_mirrorId_clientRunId_key" ON "client_task_mirror_runs"("mirrorId", "clientRunId");

-- CreateIndex
CREATE INDEX "client_task_participations_subscriptionId_startedAt_idx" ON "client_task_participations"("subscriptionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_task_participations_mirrorId_clientRunId_executionId_key" ON "client_task_participations"("mirrorId", "clientRunId", "executionId");

-- CreateIndex
CREATE INDEX "client_task_mirrors_enterpriseId_queuedAt_id_idx" ON "client_task_mirrors"("enterpriseId", "queuedAt", "id");

-- CreateIndex
CREATE INDEX "client_task_mirror_events_participationId_sequence_idx" ON "client_task_mirror_events"("participationId", "sequence");

-- AddForeignKey
ALTER TABLE "client_task_mirror_runs" ADD CONSTRAINT "client_task_mirror_runs_mirrorId_fkey" FOREIGN KEY ("mirrorId") REFERENCES "client_task_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_task_participations" ADD CONSTRAINT "client_task_participations_mirrorId_fkey" FOREIGN KEY ("mirrorId") REFERENCES "client_task_mirrors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_task_participations" ADD CONSTRAINT "client_task_participations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "client_task_mirror_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_task_mirror_events" ADD CONSTRAINT "client_task_mirror_events_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "client_task_participations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
