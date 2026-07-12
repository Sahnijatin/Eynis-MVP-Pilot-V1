-- Add a unique constraint on Contact (physical table "Guest") over (hotelId, phoneE164)
-- to stop duplicate contacts from concurrent inbound messages. Existing duplicates are
-- deduplicated first: keep the earliest row per (hotelId, phoneE164), repoint every
-- referencing row to it, then delete the rest — otherwise the unique index would fail.

-- Map each duplicate Guest id → the surviving (earliest) id in its (hotelId, phoneE164) group.
CREATE TEMP TABLE _guest_dupe_map AS
SELECT g.id AS dup_id,
       (SELECT g2.id
          FROM "Guest" g2
         WHERE g2."hotelId" = g."hotelId" AND g2."phoneE164" = g."phoneE164"
         ORDER BY g2."createdAt" ASC, g2.id ASC
         LIMIT 1) AS keep_id
FROM "Guest" g;

DELETE FROM _guest_dupe_map WHERE dup_id = keep_id;

-- Repoint FK-backed children.
UPDATE "Activity"       t SET "contactId" = m.keep_id FROM _guest_dupe_map m WHERE t."contactId" = m.dup_id;
UPDATE "Stay"           t SET "guestId"   = m.keep_id FROM _guest_dupe_map m WHERE t."guestId"   = m.dup_id;
UPDATE "ServiceRequest" t SET "guestId"   = m.keep_id FROM _guest_dupe_map m WHERE t."guestId"   = m.dup_id;
UPDATE "CampaignLead"   t SET "contactId" = m.keep_id FROM _guest_dupe_map m WHERE t."contactId" = m.dup_id;
UPDATE "Deal"           t SET "contactId" = m.keep_id FROM _guest_dupe_map m WHERE t."contactId" = m.dup_id;
UPDATE "Quote"          t SET "contactId" = m.keep_id FROM _guest_dupe_map m WHERE t."contactId" = m.dup_id;
-- Repoint loose (no-FK) references too, so they don't dangle after the delete.
UPDATE "OfferEvent"     t SET "guestId"   = m.keep_id FROM _guest_dupe_map m WHERE t."guestId"   = m.dup_id;
UPDATE "ConnectorEvent" t SET "guestId"   = m.keep_id FROM _guest_dupe_map m WHERE t."guestId"   = m.dup_id;

-- Remove the now-unreferenced duplicate contacts.
DELETE FROM "Guest" g USING _guest_dupe_map m WHERE g.id = m.dup_id;

DROP TABLE _guest_dupe_map;

-- CreateIndex
CREATE UNIQUE INDEX "Guest_hotelId_phoneE164_key" ON "Guest"("hotelId", "phoneE164");
