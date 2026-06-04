-- AlterTable
ALTER TABLE "VoiceCampaign" ADD COLUMN     "channels" TEXT NOT NULL DEFAULT '["voice"]',
ADD COLUMN     "emailBodyTemplate" TEXT,
ADD COLUMN     "emailSubjectTemplate" TEXT,
ADD COLUMN     "whatsappContentSid" TEXT,
ADD COLUMN     "whatsappTemplateBody" TEXT,
ADD COLUMN     "whatsappVariables" TEXT NOT NULL DEFAULT '[]',
ALTER COLUMN "scriptTemplate" DROP NOT NULL,
ALTER COLUMN "voiceA" DROP NOT NULL,
ALTER COLUMN "voiceB" DROP NOT NULL,
ALTER COLUMN "personaA" DROP NOT NULL,
ALTER COLUMN "personaB" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "renderedSubject" TEXT,
    "renderedBody" TEXT,
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoNotContact" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'opt_out',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoNotContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageDelivery_campaignId_channel_status_idx" ON "MessageDelivery"("campaignId", "channel", "status");

-- CreateIndex
CREATE INDEX "MessageDelivery_hotelId_createdAt_idx" ON "MessageDelivery"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "DoNotContact_hotelId_idx" ON "DoNotContact"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "DoNotContact_hotelId_phone_key" ON "DoNotContact"("hotelId", "phone");

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoiceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CampaignLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoNotContact" ADD CONSTRAINT "DoNotContact_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
