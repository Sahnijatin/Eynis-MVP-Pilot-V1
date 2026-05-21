-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "summary" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "slaDueAt" DATETIME,
    "slaBreachedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    CONSTRAINT "ServiceRequest_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceRequest_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ServiceRequest" ("assignedToUserId", "category", "createdAt", "guestId", "hotelId", "id", "resolvedAt", "source", "status", "summary", "updatedAt") SELECT "assignedToUserId", "category", "createdAt", "guestId", "hotelId", "id", "resolvedAt", "source", "status", "summary", "updatedAt" FROM "ServiceRequest";
DROP TABLE "ServiceRequest";
ALTER TABLE "new_ServiceRequest" RENAME TO "ServiceRequest";
CREATE INDEX "ServiceRequest_hotelId_status_idx" ON "ServiceRequest"("hotelId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
