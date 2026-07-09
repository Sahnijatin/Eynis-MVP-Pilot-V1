-- CreateTable
CREATE TABLE "QuoteTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Furniture',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "overheadPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "marginFloorPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "laborRatePaise" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateComponent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'material',
    "costBasis" TEXT NOT NULL DEFAULT 'area',
    "inventoryItemId" TEXT,
    "materialUnit" TEXT NOT NULL DEFAULT 'sqft',
    "defaultRatePaise" INTEGER NOT NULL DEFAULT 0,
    "defaultLengthMm" INTEGER,
    "defaultWidthMm" INTEGER,
    "defaultHeightMm" INTEGER,
    "defaultQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "wastagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "templateId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "overheadPct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "marginPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "marginFloorPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "materialCostPaise" INTEGER NOT NULL DEFAULT 0,
    "laborCostPaise" INTEGER NOT NULL DEFAULT 0,
    "overheadPaise" INTEGER NOT NULL DEFAULT 0,
    "subtotalCostPaise" INTEGER NOT NULL DEFAULT 0,
    "marginPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "marginPctActual" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "validUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL DEFAULT 'General',
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'material',
    "costBasis" TEXT NOT NULL DEFAULT 'area',
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "heightMm" INTEGER,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "inventoryItemId" TEXT,
    "materialUnit" TEXT NOT NULL DEFAULT 'sqft',
    "unitRatePaise" INTEGER NOT NULL DEFAULT 0,
    "wastagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborRatePaise" INTEGER NOT NULL DEFAULT 0,
    "computedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialCostPaise" INTEGER NOT NULL DEFAULT 0,
    "laborCostPaise" INTEGER NOT NULL DEFAULT 0,
    "lineCostPaise" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteTemplate_tenantId_isActive_idx" ON "QuoteTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteTemplate_tenantId_name_key" ON "QuoteTemplate"("tenantId", "name");

-- CreateIndex
CREATE INDEX "TemplateComponent_templateId_idx" ON "TemplateComponent"("templateId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_status_idx" ON "Quote"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Quote_dealId_idx" ON "Quote"("dealId");

-- CreateIndex
CREATE INDEX "Quote_contactId_idx" ON "Quote"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_number_key" ON "Quote"("tenantId", "number");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteId_idx" ON "QuoteLineItem"("quoteId");

-- AddForeignKey
ALTER TABLE "QuoteTemplate" ADD CONSTRAINT "QuoteTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateComponent" ADD CONSTRAINT "TemplateComponent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuoteTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
