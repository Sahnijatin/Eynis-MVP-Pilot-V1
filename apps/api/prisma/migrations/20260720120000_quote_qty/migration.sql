-- Per-quote, per-piece quantities shown on the quotation PDF: { groupName: 6 }.
ALTER TABLE "Quote" ADD COLUMN "qtyJson" TEXT;
