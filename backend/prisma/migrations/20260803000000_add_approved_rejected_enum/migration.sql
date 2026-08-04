-- Add APPROVED and REJECTED values to EmployeeStatus enum
-- These values are used in the codebase but missing from the database

ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "EmployeeStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Note: The old 'PUBLISHED' value remains in the database for backward compatibility
-- but is no longer used in schema.prisma. It can be safely ignored.
