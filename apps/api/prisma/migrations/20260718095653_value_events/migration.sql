-- CreateTable
CREATE TABLE "ValueEvent" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueAmount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "segment" TEXT,
    "contextJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValueEvent_hotelId_valueType_occurredAt_idx" ON "ValueEvent"("hotelId", "valueType", "occurredAt");

-- CreateIndex
CREATE INDEX "ValueEvent_hotelId_occurredAt_idx" ON "ValueEvent"("hotelId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ValueEvent_hotelId_sourceType_sourceId_outcome_key" ON "ValueEvent"("hotelId", "sourceType", "sourceId", "outcome");

-- AddForeignKey
ALTER TABLE "ValueEvent" ADD CONSTRAINT "ValueEvent_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
