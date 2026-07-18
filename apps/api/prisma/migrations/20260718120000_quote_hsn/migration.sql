-- Per-quote, per-piece HSN/SAC codes shown on the quotation PDF: { groupName: "9403" }.
ALTER TABLE "Quote" ADD COLUMN "hsnJson" TEXT;
