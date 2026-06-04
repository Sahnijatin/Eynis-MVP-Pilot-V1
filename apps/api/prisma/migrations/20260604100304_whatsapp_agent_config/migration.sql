-- AlterTable
ALTER TABLE "VoiceCampaign" ADD COLUMN     "whatsappAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappAgentPrompt" TEXT;

-- AlterTable
ALTER TABLE "WhatsappMessage" ADD COLUMN     "providerId" TEXT;
