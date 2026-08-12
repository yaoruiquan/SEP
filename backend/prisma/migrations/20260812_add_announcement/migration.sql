-- CreateEnum
CREATE TYPE "AnnouncementType" AS ENUM ('INFO', 'WARNING', 'ERROR', 'SUCCESS');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "AnnouncementType" NOT NULL DEFAULT 'INFO',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_published_startTime_endTime_idx" ON "announcements"("published", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "announcements_priority_idx" ON "announcements"("priority");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
