-- Add GST rate to a quote. GST is applied on the taxable total (the selling price)
-- for display on the quote/PDF and the Busy voucher; it does not affect the costing
-- or margin math, which stay pre-tax.
ALTER TABLE "Quote" ADD COLUMN "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;
