-- Plaintext token gating public image viewing/download for a quote's PDF links.
ALTER TABLE "Quote" ADD COLUMN "imageToken" TEXT;
CREATE UNIQUE INDEX "Quote_imageToken_key" ON "Quote"("imageToken");
