-- Per-tenant white-label email sending domain (E-9, Model B). Staff-provisioned
-- via the internal console; outbound email uses it only once verified.
CREATE TABLE "SendingDomain" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fromLocalPart" TEXT NOT NULL DEFAULT 'notifications',
    "fromName" TEXT,
    "resendDomainId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dnsRecords" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SendingDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SendingDomain_hotelId_key" ON "SendingDomain"("hotelId");
CREATE INDEX "SendingDomain_hotelId_idx" ON "SendingDomain"("hotelId");

ALTER TABLE "SendingDomain" ADD CONSTRAINT "SendingDomain_hotelId_fkey"
  FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
