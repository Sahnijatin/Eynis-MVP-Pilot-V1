-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerEntityId" TEXT,
    "actionType" TEXT NOT NULL,
    "actionResult" TEXT NOT NULL,
    "resultDetail" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationExecution_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectorConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "connectorKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ConnectorConfig_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConnectorEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "connectorKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'inbound_message',
    "guestPhone" TEXT,
    "guestId" TEXT,
    "guestName" TEXT,
    "rawPayload" TEXT NOT NULL,
    "aiProvider" TEXT,
    "aiCategory" TEXT,
    "aiPriority" TEXT,
    "aiSummary" TEXT,
    "aiSentiment" TEXT,
    "aiRoutingHint" TEXT,
    "aiSlaMinutes" INTEGER,
    "serviceRequestId" TEXT,
    "replyMessage" TEXT,
    "replySentAt" DATETIME,
    "replyStatus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectorEvent_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NightAuditReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'claude',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NightAuditReport_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "maxSeats" INTEGER NOT NULL DEFAULT 5,
    "renewsAt" DATETIME,
    "razorpaySubId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "License_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Role_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "invitedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "roleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "email", "fullName", "hotelId", "id", "isActive", "role", "updatedAt") SELECT "createdAt", "email", "fullName", "hotelId", "id", "isActive", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AutomationExecution_hotelId_executedAt_idx" ON "AutomationExecution"("hotelId", "executedAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_ruleId_triggerEntityId_idx" ON "AutomationExecution"("ruleId", "triggerEntityId");

-- CreateIndex
CREATE INDEX "ConnectorConfig_hotelId_enabled_idx" ON "ConnectorConfig"("hotelId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorConfig_hotelId_connectorKey_key" ON "ConnectorConfig"("hotelId", "connectorKey");

-- CreateIndex
CREATE INDEX "ConnectorEvent_hotelId_connectorKey_createdAt_idx" ON "ConnectorEvent"("hotelId", "connectorKey", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorEvent_hotelId_createdAt_idx" ON "ConnectorEvent"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "NightAuditReport_hotelId_generatedAt_idx" ON "NightAuditReport"("hotelId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NightAuditReport_hotelId_reportDate_key" ON "NightAuditReport"("hotelId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "License_hotelId_key" ON "License"("hotelId");

-- CreateIndex
CREATE INDEX "Role_hotelId_idx" ON "Role"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_hotelId_key_key" ON "Role"("hotelId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_hotelId_email_idx" ON "Invitation"("hotelId", "email");

-- CreateIndex
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");
