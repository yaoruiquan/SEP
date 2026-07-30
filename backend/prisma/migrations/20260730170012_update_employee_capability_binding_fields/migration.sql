-- AlterEnum: Update EmployeeStatus enum
-- Add PENDING, APPROVED, REJECTED; Remove PUBLISHED
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Rename PUBLISHED to APPROVED (since we can't drop enum values with data)
UPDATE "digital_employees" SET "status" = 'APPROVED' WHERE "status" = 'PUBLISHED';

-- AlterTable: Update employee_capability_bindings table
-- Remove 'order' column, add 'priority', 'enabled', 'config', 'updatedAt'

ALTER TABLE "employee_capability_bindings" DROP COLUMN IF EXISTS "order";

ALTER TABLE "employee_capability_bindings"
  ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "config" JSONB,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add index on capabilityId if it doesn't exist
CREATE INDEX IF NOT EXISTS "employee_capability_bindings_capabilityId_idx" ON "employee_capability_bindings"("capabilityId");
