-- AlterTable
ALTER TABLE "SequenceStep" ADD COLUMN     "whatsappTemplateId" TEXT;

-- AlterTable
ALTER TABLE "VoiceCampaign" ADD COLUMN     "whatsappTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "VoiceCampaign" ADD CONSTRAINT "VoiceCampaign_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
