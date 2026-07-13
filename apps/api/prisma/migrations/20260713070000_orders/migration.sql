-- Phase 7: fulfillment pipeline — accepted quotes become Orders with stage history.
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "promisedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderTransition" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStage" TEXT NOT NULL,
    "toStage" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");
CREATE UNIQUE INDEX "Order_hotelId_number_key" ON "Order"("hotelId", "number");
CREATE INDEX "Order_hotelId_stage_idx" ON "Order"("hotelId", "stage");
CREATE INDEX "OrderTransition_orderId_createdAt_idx" ON "OrderTransition"("orderId", "createdAt");

ALTER TABLE "Order" ADD CONSTRAINT "Order_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderTransition" ADD CONSTRAINT "OrderTransition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
