-- Drop the deprecated A/B columns from VoiceCampaign. CampaignVariant has been
-- the source of truth since 20260606130000_add_campaign_variants, which backfilled
-- these columns into variant rows. This drop is lossless: the data was copied
-- (not moved) into CampaignVariant.

-- Safety net: backfill any voice campaign that somehow still lacks variant rows
-- (idempotent; a no-op once every campaign has been migrated) BEFORE we drop the
-- source columns, so no A/B configuration is lost.
INSERT INTO "CampaignVariant" ("id","campaignId","hotelId","key","label","voice","persona","scriptOverride","vapiAssistantId","weight","sortOrder","createdAt","updatedAt")
SELECT 'cv_' || replace(gen_random_uuid()::text, '-', ''), c."id", c."hotelId", 'A',
       COALESCE(c."personaA", 'Variant A'), c."voiceA", c."personaA", NULL, c."vapiAssistantIdA", 1, 0, now(), now()
FROM "VoiceCampaign" c
WHERE c."channels" LIKE '%voice%'
  AND (c."voiceA" IS NOT NULL OR c."personaA" IS NOT NULL OR c."vapiAssistantIdA" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "CampaignVariant" v WHERE v."campaignId" = c."id");

INSERT INTO "CampaignVariant" ("id","campaignId","hotelId","key","label","voice","persona","scriptOverride","vapiAssistantId","weight","sortOrder","createdAt","updatedAt")
SELECT 'cv_' || replace(gen_random_uuid()::text, '-', ''), c."id", c."hotelId", 'B',
       COALESCE(c."personaB", 'Variant B'), c."voiceB", c."personaB", NULL, c."vapiAssistantIdB", 1, 1, now(), now()
FROM "VoiceCampaign" c
WHERE c."channels" LIKE '%voice%'
  AND (c."voiceB" IS NOT NULL OR c."personaB" IS NOT NULL OR c."vapiAssistantIdB" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "CampaignVariant" v WHERE v."campaignId" = c."id" AND v."key" = 'B');

-- DropColumns
ALTER TABLE "VoiceCampaign"
  DROP COLUMN "voiceA",
  DROP COLUMN "voiceB",
  DROP COLUMN "personaA",
  DROP COLUMN "personaB",
  DROP COLUMN "vapiAssistantIdA",
  DROP COLUMN "vapiAssistantIdB";
