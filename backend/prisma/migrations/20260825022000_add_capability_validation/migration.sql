-- Persist the latest non-secret automatic validation result for Skill versions.
ALTER TABLE "skill_versions"
  ADD COLUMN "validationResult" JSONB,
  ADD COLUMN "validatedAt" TIMESTAMP(3);
