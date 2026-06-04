-- AlterTable
ALTER TABLE "VoiceCampaign" ADD COLUMN     "scheduledStartAt" TIMESTAMP(3),
ADD COLUMN     "sendDays" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "sendTimeZone" TEXT,
ADD COLUMN     "sendWindowEndMin" INTEGER,
ADD COLUMN     "sendWindowStartMin" INTEGER;
