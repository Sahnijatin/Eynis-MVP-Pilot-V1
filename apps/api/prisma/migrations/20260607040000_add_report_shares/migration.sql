-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportShare_reportId_idx" ON "ReportShare"("reportId");

-- CreateIndex
CREATE INDEX "ReportShare_hotelId_principalType_principalId_idx" ON "ReportShare"("hotelId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_reportId_principalType_principalId_key" ON "ReportShare"("reportId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
