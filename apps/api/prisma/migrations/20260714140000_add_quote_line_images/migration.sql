-- Per-piece images shown on the quotation PDF: JSON map { groupName: dataUrl[] }, max 3 per row.
ALTER TABLE "Quote" ADD COLUMN "lineImagesJson" TEXT;
