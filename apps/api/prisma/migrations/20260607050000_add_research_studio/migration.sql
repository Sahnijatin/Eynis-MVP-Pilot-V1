-- CreateTable
CREATE TABLE "ResearchTemplate" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectType" TEXT NOT NULL DEFAULT 'freeform',
    "inputsJson" TEXT NOT NULL,
    "sourcesJson" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "templateSnapshot" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT 'freeform',
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "inputsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "gatheredJson" TEXT,
    "resultJson" TEXT,
    "score" INTEGER,
    "usageJson" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSourceCache" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSourceCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchShare" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchTemplate_hotelId_idx" ON "ResearchTemplate"("hotelId");

-- CreateIndex
CREATE INDEX "ResearchRun_hotelId_idx" ON "ResearchRun"("hotelId");

-- CreateIndex
CREATE INDEX "ResearchRun_hotelId_status_idx" ON "ResearchRun"("hotelId", "status");

-- CreateIndex
CREATE INDEX "ResearchRun_hotelId_subjectType_subjectId_idx" ON "ResearchRun"("hotelId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ResearchSourceCache_hotelId_idx" ON "ResearchSourceCache"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSourceCache_hotelId_urlHash_key" ON "ResearchSourceCache"("hotelId", "urlHash");

-- CreateIndex
CREATE INDEX "ResearchShare_runId_idx" ON "ResearchShare"("runId");

-- CreateIndex
CREATE INDEX "ResearchShare_hotelId_principalType_principalId_idx" ON "ResearchShare"("hotelId", "principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchShare_runId_principalType_principalId_key" ON "ResearchShare"("runId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "ResearchTemplate" ADD CONSTRAINT "ResearchTemplate_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchTemplate" ADD CONSTRAINT "ResearchTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ResearchTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSourceCache" ADD CONSTRAINT "ResearchSourceCache_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchShare" ADD CONSTRAINT "ResearchShare_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
