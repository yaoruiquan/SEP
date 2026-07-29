-- CreateTable employee_packages
CREATE TABLE "employee_packages" (
    "id"            TEXT NOT NULL,
    "employeeId"    TEXT NOT NULL,
    "version"       TEXT NOT NULL,
    "filename"      TEXT NOT NULL,
    "storagePath"   TEXT NOT NULL,
    "sha256"        TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy"    TEXT NOT NULL,
    "changelog"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_packages_employeeId_createdAt_idx"
    ON "employee_packages"("employeeId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "employee_packages"
    ADD CONSTRAINT "employee_packages_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "digital_employees"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
