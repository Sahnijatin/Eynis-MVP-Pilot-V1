-- Per-quote quotation letterhead snapshot (seller business/tax/bank details + bill-to).
ALTER TABLE "Quote" ADD COLUMN "sellerJson" TEXT;
ALTER TABLE "Quote" ADD COLUMN "billToJson" TEXT;
