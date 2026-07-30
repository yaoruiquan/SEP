-- Add new enum values PENDING, APPROVED, REJECTED to EmployeeStatus
-- Note: These must be added outside a transaction block
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
