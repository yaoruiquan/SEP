-- Keep task execution sessions out of the chat center at the data boundary.
CREATE TYPE "ConversationSource" AS ENUM ('CHAT', 'TASK');

ALTER TABLE "conversation_sessions"
  ADD COLUMN "source" "ConversationSource" NOT NULL DEFAULT 'CHAT',
  ADD COLUMN "taskPlanId" TEXT,
  ADD COLUMN "taskStepId" TEXT;

CREATE INDEX "conversation_sessions_userId_source_idx"
  ON "conversation_sessions"("userId", "source");

CREATE INDEX "conversation_sessions_taskPlanId_taskStepId_idx"
  ON "conversation_sessions"("taskPlanId", "taskStepId");
