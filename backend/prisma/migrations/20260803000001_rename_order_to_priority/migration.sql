-- Rename 'order' column to 'priority' in employee_capability_bindings table
-- to match the schema.prisma definition

ALTER TABLE "employee_capability_bindings" RENAME COLUMN "order" TO "priority";

-- Add default value and enabled column if they don't exist
ALTER TABLE "employee_capability_bindings"
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "employee_capability_bindings"
  ADD COLUMN IF NOT EXISTS "config" JSONB;

-- Set default value for priority if not already set
ALTER TABLE "employee_capability_bindings"
  ALTER COLUMN "priority" SET DEFAULT 0,
  ALTER COLUMN "priority" SET NOT NULL;

ALTER TABLE "employee_capability_bindings"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
