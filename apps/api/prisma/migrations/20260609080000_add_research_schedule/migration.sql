-- Scheduled / recurring re-research (RS-4). Snapshots run params so it survives
-- deletion of the originating run; the worker claims a due row by advancing
-- nextRunAt before enqueueing (no double-runs).
CREATE TABLE "ResearchSchedule" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "templateSnapshot" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT 'freeform',
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "inputsJson" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ResearchSchedule_hotelId_idx" ON "ResearchSchedule"("hotelId");
CREATE INDEX "ResearchSchedule_isActive_nextRunAt_idx" ON "ResearchSchedule"("isActive", "nextRunAt");

ALTER TABLE "ResearchSchedule" ADD CONSTRAINT "ResearchSchedule_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchSchedule" ADD CONSTRAINT "ResearchSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
