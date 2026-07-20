-- Anti-spam daily-cap ledger for automated operational WhatsApp sends (#168).
CREATE TABLE "AutomatedMessageLog" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomatedMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomatedMessageLog_hotelId_address_createdAt_idx" ON "AutomatedMessageLog"("hotelId", "address", "createdAt");

ALTER TABLE "AutomatedMessageLog" ADD CONSTRAINT "AutomatedMessageLog_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
