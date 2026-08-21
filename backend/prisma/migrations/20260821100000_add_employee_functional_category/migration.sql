-- Stable marketplace taxonomy; category is independent from free-text position/industry.
CREATE TYPE "EmployeeCategory" AS ENUM ('TECH', 'PRODUCT_DESIGN', 'MARKETING_GROWTH', 'ECOMMERCE', 'SALES_CUSTOMER', 'OPERATIONS_ORG', 'FINANCE_LEGAL');
ALTER TABLE "digital_employees" ADD COLUMN "functionalCategory" "EmployeeCategory" NOT NULL DEFAULT 'OPERATIONS_ORG';
CREATE INDEX "digital_employees_functionalCategory_idx" ON "digital_employees"("functionalCategory");
