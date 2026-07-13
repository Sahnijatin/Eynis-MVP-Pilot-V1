-- 4.1: unitCostInr (whole rupees) -> unitCostPaise (paise integer), preserving
-- existing values (x100). Add-backfill-drop so no data is lost.
ALTER TABLE "InventoryItem" ADD COLUMN "unitCostPaise" INTEGER NOT NULL DEFAULT 0;
UPDATE "InventoryItem" SET "unitCostPaise" = "unitCostInr" * 100;
ALTER TABLE "InventoryItem" DROP COLUMN "unitCostInr";

-- 4.2: immutable stock ledger. Physical FK to "Hotel" (the Tenant model's table).
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_hotelId_itemId_createdAt_idx" ON "StockMovement"("hotelId", "itemId", "createdAt");
CREATE INDEX "StockMovement_hotelId_createdAt_idx" ON "StockMovement"("hotelId", "createdAt");

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
