-- Persist automatic validation results for Agent and other non-versioned capabilities.
ALTER TABLE "capabilities"
  ADD COLUMN "validationResult" JSONB,
  ADD COLUMN "validatedAt" TIMESTAMP(3);
