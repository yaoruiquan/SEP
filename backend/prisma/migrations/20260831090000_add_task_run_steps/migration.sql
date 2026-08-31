-- 任务步骤提升为一等实体 + 最终交付物 + worker 心跳
--
-- 背景：执行引擎原先跑在浏览器里（web/src/app/(enterprise)/tasks/page.tsx 的
-- executePlan 循环），关掉标签页任务就死。搬到服务端后，步骤状态需要能被
-- 并发安全地单独更新，而 task_runs.steps 这个整体重写的 JSON 快照做不到。
--
-- task_runs.steps 保留为兼容读字段，本迁移把存量数据展开成 task_run_steps 行。

-- CreateEnum
CREATE TYPE "TASK_STEP_STATUS" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'PAUSED');

-- AlterEnum
-- 本迁移只新增枚举值、不使用它们，因此可以安全地放在同一个事务里。
ALTER TYPE "TASK_EVENT_TYPE" ADD VALUE 'STEP_HANDOFF';
ALTER TYPE "TASK_EVENT_TYPE" ADD VALUE 'DELIVERABLE_READY';

-- AlterTable
ALTER TABLE "task_run_events" ADD COLUMN     "payload" JSONB;

-- AlterTable
ALTER TABLE "task_runs" ADD COLUMN     "claimedBy" TEXT,
ADD COLUMN     "deliverable" TEXT,
ADD COLUMN     "deliverableDegraded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliverableGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "stopRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "task_run_steps" (
    "id" TEXT NOT NULL,
    "taskRunId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "employeeAvatar" TEXT,
    "capabilityId" TEXT NOT NULL,
    "capabilityName" TEXT NOT NULL,
    "skillVersionId" TEXT,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT NOT NULL DEFAULT '',
    "estimatedSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" "TASK_STEP_STATUS" NOT NULL DEFAULT 'QUEUED',
    "inputPrompt" TEXT,
    "handoff" JSONB,
    "output" TEXT,
    "error" TEXT,
    "sessionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_run_steps_taskRunId_order_idx" ON "task_run_steps"("taskRunId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "task_run_steps_taskRunId_stepKey_key" ON "task_run_steps"("taskRunId", "stepKey");

-- CreateIndex
CREATE INDEX "task_runs_status_heartbeatAt_idx" ON "task_runs"("status", "heartbeatAt");

-- AddForeignKey
ALTER TABLE "task_run_steps" ADD CONSTRAINT "task_run_steps_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "task_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 存量回填：把 task_runs.steps 里的 TaskPlanStep[] 展开成行
--
-- 用 md5 生成确定性主键（不是 cuid）：迁移重跑时同一条记录得到同一个 id，
-- 配合 ON CONFLICT DO NOTHING 保证幂等。
-- 时间字段是 ISO 字符串，无效值统一转成 NULL 而不是让整条迁移失败 ——
-- 存量数据里出现过空字符串。
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "task_run_steps" (
  "id", "taskRunId", "stepKey", "order", "title", "description",
  "employeeId", "employeeName", "employeeAvatar",
  "capabilityId", "capabilityName",
  "dependsOn", "rationale", "estimatedSeconds", "status",
  "output", "error", "startedAt", "completedAt", "durationMs",
  "createdAt", "updatedAt"
)
SELECT
  md5(r."id" || ':' || COALESCE(s->>'id', ord::text)),
  r."id",
  COALESCE(NULLIF(s->>'id', ''), 'step-' || ord::text),
  COALESCE((s->>'order')::int, ord),
  COALESCE(NULLIF(s->>'title', ''), '未命名步骤'),
  COALESCE(s->>'description', ''),
  COALESCE(s->'employee'->>'id', ''),
  COALESCE(NULLIF(s->'employee'->>'name', ''), '未知员工'),
  NULLIF(s->'employee'->>'avatar', ''),
  COALESCE(s->'capability'->>'id', ''),
  COALESCE(NULLIF(s->'capability'->>'name', ''), '未知能力'),
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(s->'dependsOn') = 'array' THEN s->'dependsOn' ELSE '[]'::jsonb END
    )),
    ARRAY[]::text[]
  ),
  COALESCE(s->>'rationale', ''),
  COALESCE((s->>'estimatedSeconds')::int, 0),
  CASE s->>'status'
    WHEN 'running'   THEN 'RUNNING'::"TASK_STEP_STATUS"
    WHEN 'completed' THEN 'COMPLETED'::"TASK_STEP_STATUS"
    WHEN 'failed'    THEN 'FAILED'::"TASK_STEP_STATUS"
    WHEN 'skipped'   THEN 'SKIPPED'::"TASK_STEP_STATUS"
    ELSE 'QUEUED'::"TASK_STEP_STATUS"
  END,
  NULLIF(s->>'output', ''),
  NULLIF(s->>'error', ''),
  CASE WHEN (s->>'startedAt')   ~ '^\d{4}-' THEN (s->>'startedAt')::timestamp   ELSE NULL END,
  CASE WHEN (s->>'completedAt') ~ '^\d{4}-' THEN (s->>'completedAt')::timestamp ELSE NULL END,
  CASE WHEN (s->>'durationMs') ~ '^\d+$' THEN (s->>'durationMs')::int ELSE NULL END,
  r."createdAt",
  r."updatedAt"
FROM "task_runs" r
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(r."steps") = 'array' THEN r."steps" ELSE '[]'::jsonb END
) WITH ORDINALITY AS t(s, ord)
ON CONFLICT ("id") DO NOTHING;

-- 存量里挂在 RUNNING 的运行没有 worker 在跑（旧实现执行在浏览器里）。
-- 给个过去的心跳，让新的孤儿回收 cron 下一轮就把它们收干净。
UPDATE "task_runs"
SET "heartbeatAt" = "updatedAt"
WHERE "status" = 'RUNNING' AND "heartbeatAt" IS NULL;
