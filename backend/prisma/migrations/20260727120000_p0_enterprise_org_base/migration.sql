-- CreateEnum
CREATE TYPE "EnterpriseRole" AS ENUM ('ENTERPRISE_ADMIN', 'DEPT_MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- DropForeignKey
ALTER TABLE "compute_accounts" DROP CONSTRAINT "compute_accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_userId_fkey";

-- DropIndex
DROP INDEX "compute_accounts_userId_key";

-- DropIndex
DROP INDEX "subscriptions_userId_employeeId_key";

-- AlterTable
ALTER TABLE "compute_accounts" DROP COLUMN "userId",
ADD COLUMN     "enterpriseId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "userId",
ADD COLUMN     "enterpriseId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "enterprises" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "role" "EnterpriseRole" NOT NULL DEFAULT 'MEMBER',
    "departmentId" TEXT,
    "position" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_instances" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "InstanceStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_grants" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "departmentId" TEXT,
    "memberId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "enterpriseId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "reason" TEXT,
    "requestedDays" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "departments_enterpriseId_idx" ON "departments"("enterpriseId");

-- CreateIndex
CREATE INDEX "departments_parentId_idx" ON "departments"("parentId");

-- CreateIndex
CREATE INDEX "enterprise_members_enterpriseId_idx" ON "enterprise_members"("enterpriseId");

-- CreateIndex
CREATE INDEX "enterprise_members_departmentId_idx" ON "enterprise_members"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_members_userId_enterpriseId_key" ON "enterprise_members"("userId", "enterpriseId");

-- CreateIndex
CREATE INDEX "employee_instances_enterpriseId_idx" ON "employee_instances"("enterpriseId");

-- CreateIndex
CREATE INDEX "employee_instances_templateId_idx" ON "employee_instances"("templateId");

-- CreateIndex
CREATE INDEX "employee_instances_departmentId_idx" ON "employee_instances"("departmentId");

-- CreateIndex
CREATE INDEX "employee_grants_instanceId_idx" ON "employee_grants"("instanceId");

-- CreateIndex
CREATE INDEX "employee_grants_departmentId_idx" ON "employee_grants"("departmentId");

-- CreateIndex
CREATE INDEX "employee_grants_memberId_idx" ON "employee_grants"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_grants_instanceId_departmentId_memberId_key" ON "employee_grants"("instanceId", "departmentId", "memberId");

-- CreateIndex
CREATE INDEX "access_requests_enterpriseId_idx" ON "access_requests"("enterpriseId");

-- CreateIndex
CREATE INDEX "access_requests_requesterId_idx" ON "access_requests"("requesterId");

-- CreateIndex
CREATE INDEX "access_requests_instanceId_idx" ON "access_requests"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "compute_accounts_enterpriseId_key" ON "compute_accounts"("enterpriseId");

-- CreateIndex
CREATE INDEX "subscriptions_enterpriseId_idx" ON "subscriptions"("enterpriseId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_enterpriseId_employeeId_key" ON "subscriptions"("enterpriseId", "employeeId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enterprise_members" ADD CONSTRAINT "enterprise_members_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_instances" ADD CONSTRAINT "employee_instances_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_instances" ADD CONSTRAINT "employee_instances_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "digital_employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_instances" ADD CONSTRAINT "employee_instances_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_grants" ADD CONSTRAINT "employee_grants_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "employee_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_grants" ADD CONSTRAINT "employee_grants_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_grants" ADD CONSTRAINT "employee_grants_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "enterprise_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "enterprise_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "employee_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compute_accounts" ADD CONSTRAINT "compute_accounts_enterpriseId_fkey" FOREIGN KEY ("enterpriseId") REFERENCES "enterprises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

