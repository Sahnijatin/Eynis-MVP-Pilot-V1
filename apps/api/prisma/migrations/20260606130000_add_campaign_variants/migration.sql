-- Dynamic A/B/N campaign variants (E-7). One campaign -> 1..N variant arms.

-- CreateTable
CREATE TABLE "CampaignVariant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "voice" TEXT,
    "persona" TEXT,
    "scriptOverride" TEXT,
    "vapiAssistantId" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignVariant_campaignId_idx" ON "CampaignVariant"("campaignId");
CREATE UNIQUE INDEX "CampaignVariant_campaignId_key_key" ON "CampaignVariant"("campaignId", "key");

-- AddForeignKey
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoiceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: migrate each existing voice campaign's A/B config into two variant rows.
INSERT INTO "CampaignVariant" ("id","campaignId","hotelId","key","label","voice","persona","scriptOverride","vapiAssistantId","weight","sortOrder","createdAt","updatedAt")
SELECT 'cv_' || replace(gen_random_uuid()::text, '-', ''), c."id", c."hotelId", 'A',
       COALESCE(c."personaA", 'Variant A'), c."voiceA", c."personaA", NULL, c."vapiAssistantIdA", 1, 0, now(), now()
FROM "VoiceCampaign" c
WHERE c."voiceA" IS NOT NULL OR c."personaA" IS NOT NULL OR c."vapiAssistantIdA" IS NOT NULL;

INSERT INTO "CampaignVariant" ("id","campaignId","hotelId","key","label","voice","persona","scriptOverride","vapiAssistantId","weight","sortOrder","createdAt","updatedAt")
SELECT 'cv_' || replace(gen_random_uuid()::text, '-', ''), c."id", c."hotelId", 'B',
       COALESCE(c."personaB", 'Variant B'), c."voiceB", c."personaB", NULL, c."vapiAssistantIdB", 1, 1, now(), now()
FROM "VoiceCampaign" c
WHERE c."voiceB" IS NOT NULL OR c."personaB" IS NOT NULL OR c."vapiAssistantIdB" IS NOT NULL;
