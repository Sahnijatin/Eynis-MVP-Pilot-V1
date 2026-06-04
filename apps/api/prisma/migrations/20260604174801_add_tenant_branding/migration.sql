-- CreateTable
CREATE TABLE "TenantBranding" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "brandName" TEXT,
    "tagline" TEXT,
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "supportEmail" TEXT,
    "hidePoweredBy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantBranding_hotelId_key" ON "TenantBranding"("hotelId");

-- CreateIndex
CREATE INDEX "TenantBranding_hotelId_idx" ON "TenantBranding"("hotelId");

-- AddForeignKey
ALTER TABLE "TenantBranding" ADD CONSTRAINT "TenantBranding_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
