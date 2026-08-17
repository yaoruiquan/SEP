/*
  Warnings:

  - You are about to drop the `access_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SubscriptionRequestKind" AS ENUM ('SUBSCRIBE', 'GRANT');

-- DropForeignKey
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_enterpriseId_fkey";

-- DropForeignKey
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_requesterId_fkey";

-- DropForeignKey
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_subscriptionId_fkey";

-- AlterTable
ALTER TABLE "subscription_requests" ADD COLUMN     "kind" "SubscriptionRequestKind" NOT NULL DEFAULT 'SUBSCRIBE';

-- DropTable
DROP TABLE "access_requests";
