-- Per-quote, per-piece GST rate overrides for mixed-rate quotes: { groupName: 12 }.
ALTER TABLE "Quote" ADD COLUMN "gstRatesJson" TEXT;
