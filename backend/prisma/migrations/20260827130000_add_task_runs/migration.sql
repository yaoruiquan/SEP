CREATE TYPE "TASK_RUN_STATUS" AS ENUM ('DRAFT','AWAITING_CONFIRMATION','RUNNING','COMPLETED','FAILED','STOPPED');
CREATE TYPE "TASK_EVENT_TYPE" AS ENUM ('RUN_CREATED','RUN_STARTED','RUN_COMPLETED','RUN_FAILED','RUN_STOPPED','STEP_STARTED','STEP_COMPLETED','STEP_FAILED','STEP_SKIPPED','STEP_PAUSED','STEP_RESUMED','PLAN_EDITED');
CREATE TABLE "task_runs" (
  "id" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "status" "TASK_RUN_STATUS" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  "steps" JSONB NOT NULL,
  "layout" JSONB,
  "planner" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "userId" TEXT NOT NULL,
  "enterpriseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "task_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "steps" JSONB NOT NULL,
  "layout" JSONB,
  "userId" TEXT NOT NULL,
  "enterpriseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "task_run_events" (
  "id" TEXT NOT NULL,
  "taskRunId" TEXT NOT NULL,
  "type" "TASK_EVENT_TYPE" NOT NULL,
  "stepId" TEXT,
  "stepTitle" TEXT,
  "employeeName" TEXT,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_run_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_runs_userId_createdAt_idx" ON "task_runs"("userId","createdAt");
CREATE INDEX "task_runs_enterpriseId_createdAt_idx" ON "task_runs"("enterpriseId","createdAt");
CREATE INDEX "task_templates_userId_createdAt_idx" ON "task_templates"("userId","createdAt");
CREATE INDEX "task_run_events_taskRunId_createdAt_idx" ON "task_run_events"("taskRunId","createdAt");
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_runs" ADD CONSTRAINT "task_runs_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_run_events" ADD CONSTRAINT "task_run_events_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "task_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
