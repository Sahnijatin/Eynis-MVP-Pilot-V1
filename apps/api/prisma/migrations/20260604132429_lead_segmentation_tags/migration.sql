-- AlterTable
ALTER TABLE "CampaignLead" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "VoiceCampaign" ADD COLUMN     "segmentId" TEXT;

-- CreateTable
CREATE TABLE "LeadSegment" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSegment_hotelId_idx" ON "LeadSegment"("hotelId");

-- AddForeignKey
ALTER TABLE "VoiceCampaign" ADD CONSTRAINT "VoiceCampaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "LeadSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSegment" ADD CONSTRAINT "LeadSegment_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
